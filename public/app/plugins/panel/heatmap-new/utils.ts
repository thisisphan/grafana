import { MutableRefObject, RefObject } from 'react';
import {
  ArrayVector,
  DataFrame,
  dateTimeFormat,
  Field,
  GrafanaTheme2,
  PanelData,
  SplitOpen,
  systemDateFormats,
  TimeRange,
  TimeZone,
  ValueLinkConfig,
} from '@grafana/data';
import { AxisPlacement, ScaleDirection, ScaleOrientation } from '@grafana/schema';
import { UPlotConfigBuilder } from '@grafana/ui';
import uPlot from 'uplot';

import { pointWithin, Quadtree, Rect } from '../barchart/quadtree';
import { BucketLayout, HeatmapData } from './fields';
import { HeatmapLookup } from './types';
import { getFieldLinksForExplore } from 'app/features/explore/utils/links';

interface PathbuilderOpts {
  each: (u: uPlot, seriesIdx: number, dataIdx: number, lft: number, top: number, wid: number, hgt: number) => void;
  gap?: number | null;
  hideThreshold?: number;
  xCeil?: boolean;
  yCeil?: boolean;
  disp: {
    fill: {
      values: (u: uPlot, seriesIndex: number) => number[];
      index: Array<CanvasRenderingContext2D['fillStyle']>;
    };
  };
}

export interface HeatmapHoverEvent {
  index: number;
  pageX: number;
  pageY: number;
}

export interface HeatmapZoomEvent {
  xMin: number;
  xMax: number;
}

interface PrepConfigOpts {
  dataRef: RefObject<HeatmapData>;
  theme: GrafanaTheme2;
  onhover?: null | ((evt?: HeatmapHoverEvent | null) => void);
  onclick?: null | ((evt?: any) => void);
  onzoom?: null | ((evt: HeatmapZoomEvent) => void);
  isToolTipOpen: MutableRefObject<boolean>;
  timeZone: string;
  getTimeRange: () => TimeRange;
  palette: string[];
  cellGap?: number | null; // in css pixels
  hideThreshold?: number;
}

export function prepConfig(opts: PrepConfigOpts) {
  const {
    dataRef,
    theme,
    onhover,
    onclick,
    onzoom,
    isToolTipOpen,
    timeZone,
    getTimeRange,
    palette,
    cellGap,
    hideThreshold,
  } = opts;

  let qt: Quadtree;
  let hRect: Rect | null;

  let builder = new UPlotConfigBuilder(timeZone);

  let rect: DOMRect;

  builder.addHook('init', (u) => {
    u.root.querySelectorAll('.u-cursor-pt').forEach((el) => {
      Object.assign((el as HTMLElement).style, {
        borderRadius: '0',
        border: '1px solid white',
        background: 'transparent',
      });
    });

    onclick &&
      u.over.addEventListener(
        'mouseup',
        (e) => {
          // @ts-ignore
          let isDragging: boolean = u.cursor.drag._x || u.cursor.drag._y;

          if (!isDragging) {
            onclick(e);
          }
        },
        true
      );
  });

  onzoom &&
    builder.addHook('setSelect', (u) => {
      onzoom({
        xMin: u.posToVal(u.select.left, 'x'),
        xMax: u.posToVal(u.select.left + u.select.width, 'x'),
      });
      u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    });

  // this is a tmp hack because in mode: 2, uplot does not currently call scales.x.range() for setData() calls
  // scales.x.range() typically reads back from drilled-down panelProps.timeRange via getTimeRange()
  builder.addHook('setData', (u) => {
    //let [min, max] = (u.scales!.x!.range! as uPlot.Range.Function)(u, 0, 100, 'x');

    let { min: xMin, max: xMax } = u.scales!.x;

    let min = getTimeRange().from.valueOf();
    let max = getTimeRange().to.valueOf();

    if (xMin !== min || xMax !== max) {
      queueMicrotask(() => {
        u.setScale('x', { min, max });
      });
    }
  });

  // rect of .u-over (grid area)
  builder.addHook('syncRect', (u, r) => {
    rect = r;
  });

  let pendingOnleave = 0;

  onhover &&
    builder.addHook('setLegend', (u) => {
      if (u.cursor.idxs != null) {
        for (let i = 0; i < u.cursor.idxs.length; i++) {
          const sel = u.cursor.idxs[i];
          if (sel != null && !isToolTipOpen.current) {
            if (pendingOnleave) {
              clearTimeout(pendingOnleave);
              pendingOnleave = 0;
            }

            onhover({
              index: sel,
              pageX: rect.left + u.cursor.left!,
              pageY: rect.top + u.cursor.top!,
            });

            return; // only show the first one
          }
        }
      }

      if (!isToolTipOpen.current) {
        // if tiles have gaps, reduce flashing / re-render (debounce onleave by 100ms)
        if (!pendingOnleave) {
          pendingOnleave = setTimeout(() => onhover(null), 100) as any;
        }
      }
    });

  builder.addHook('drawClear', (u) => {
    qt = qt || new Quadtree(0, 0, u.bbox.width, u.bbox.height);

    qt.clear();

    // force-clear the path cache to cause drawBars() to rebuild new quadtree
    u.series.forEach((s, i) => {
      if (i > 0) {
        // @ts-ignore
        s._paths = null;
      }
    });
  });

  builder.setMode(2);

  builder.addScale({
    scaleKey: 'x',
    isTime: true,
    orientation: ScaleOrientation.Horizontal,
    direction: ScaleDirection.Right,
    // TODO: expand by x bucket size and layout
    range: () => {
      return [getTimeRange().from.valueOf(), getTimeRange().to.valueOf()];
    },
  });

  builder.addAxis({
    scaleKey: 'x',
    placement: AxisPlacement.Bottom,
    isTime: true,
    theme: theme,
  });

  builder.addScale({
    scaleKey: 'y',
    isTime: false,
    // distribution: ScaleDistribution.Ordinal, // does not work with facets/scatter yet
    orientation: ScaleOrientation.Vertical,
    direction: ScaleDirection.Up,
    range: (u, dataMin, dataMax) => {
      let bucketSize = dataRef.current?.yBucketSize;

      if (dataRef.current?.yLayout === BucketLayout.le) {
        dataMin -= bucketSize!;
      } else {
        dataMax += bucketSize!;
      }

      return [dataMin, dataMax];
    },
  });

  const hasLabeledY = dataRef.current?.yAxisValues != null;

  builder.addAxis({
    scaleKey: 'y',
    placement: AxisPlacement.Left,
    theme: theme,
    splits: hasLabeledY
      ? () => {
          let ys = dataRef.current?.heatmap?.fields[1].values.toArray()!;
          let splits = ys.slice(0, ys.length - ys.lastIndexOf(ys[0]));

          let bucketSize = dataRef.current?.yBucketSize!;

          if (dataRef.current?.yLayout === BucketLayout.le) {
            splits.unshift(ys[0] - bucketSize);
          } else {
            splits.push(ys[ys.length - 1] + bucketSize);
          }

          return splits;
        }
      : undefined,
    values: hasLabeledY
      ? () => {
          let yAxisValues = dataRef.current?.yAxisValues?.slice()!;

          if (dataRef.current?.yLayout === BucketLayout.le) {
            yAxisValues.unshift('0.0'); // assumes dense layout where lowest bucket's low bound is 0-ish
          } else {
            yAxisValues.push('+Inf');
          }

          return yAxisValues;
        }
      : undefined,
  });

  builder.addSeries({
    facets: [
      {
        scale: 'x',
        auto: true,
        sorted: 1,
      },
      {
        scale: 'y',
        auto: true,
      },
    ],
    pathBuilder: heatmapPaths({
      each: (u, seriesIdx, dataIdx, x, y, xSize, ySize) => {
        qt.add({
          x: x - u.bbox.left,
          y: y - u.bbox.top,
          w: xSize,
          h: ySize,
          sidx: seriesIdx,
          didx: dataIdx,
        });
      },
      gap: cellGap,
      hideThreshold,
      xCeil: dataRef.current?.xLayout === BucketLayout.le,
      yCeil: dataRef.current?.yLayout === BucketLayout.le,
      disp: {
        fill: {
          values: (u, seriesIdx) => countsToFills(u, seriesIdx, palette),
          index: palette,
        },
      },
    }) as any,
    theme,
    scaleKey: '', // facets' scales used (above)
  });

  builder.setCursor({
    drag: {
      x: true,
      y: false,
      setScale: false,
    },
    dataIdx: (u, seriesIdx) => {
      if (seriesIdx === 1) {
        hRect = null;

        let cx = u.cursor.left! * devicePixelRatio;
        let cy = u.cursor.top! * devicePixelRatio;

        qt.get(cx, cy, 1, 1, (o) => {
          if (pointWithin(cx, cy, o.x, o.y, o.x + o.w, o.y + o.h)) {
            hRect = o;
          }
        });
      }

      return hRect && seriesIdx === hRect.sidx ? hRect.didx : null;
    },
    points: {
      fill: 'rgba(255,255,255, 0.3)',
      bbox: (u, seriesIdx) => {
        let isHovered = hRect && seriesIdx === hRect.sidx;

        return {
          left: isHovered ? hRect!.x / devicePixelRatio : -10,
          top: isHovered ? hRect!.y / devicePixelRatio : -10,
          width: isHovered ? hRect!.w / devicePixelRatio : 0,
          height: isHovered ? hRect!.h / devicePixelRatio : 0,
        };
      },
    },
  });

  return builder;
}

export function heatmapPaths(opts: PathbuilderOpts) {
  const { disp, each, gap, hideThreshold = 0, xCeil = false, yCeil = false } = opts;

  return (u: uPlot, seriesIdx: number) => {
    uPlot.orient(
      u,
      seriesIdx,
      (
        series,
        dataX,
        dataY,
        scaleX,
        scaleY,
        valToPosX,
        valToPosY,
        xOff,
        yOff,
        xDim,
        yDim,
        moveTo,
        lineTo,
        rect,
        arc
      ) => {
        let d = u.data[seriesIdx];
        const xs = d[0] as unknown as number[];
        const ys = d[1] as unknown as number[];
        const counts = d[2] as unknown as number[];
        const dlen = xs.length;

        // fill colors are mapped from interpolating densities / counts along some gradient
        // (should be quantized to 64 colors/levels max. e.g. 16)
        let fills = disp.fill.values(u, seriesIdx);
        let fillPalette = disp.fill.index ?? [...new Set(fills)];

        let fillPaths = fillPalette.map((color) => new Path2D());

        // detect x and y bin qtys by detecting layout repetition in x & y data
        let yBinQty = dlen - ys.lastIndexOf(ys[0]);
        let xBinQty = dlen / yBinQty;
        let yBinIncr = ys[1] - ys[0];
        let xBinIncr = xs[yBinQty] - xs[0];

        // uniform tile sizes based on zoom level
        let xSize = Math.abs(valToPosX(xBinIncr, scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff));
        let ySize = Math.abs(valToPosY(yBinIncr, scaleY, yDim, yOff) - valToPosY(0, scaleY, yDim, yOff));

        const autoGapFactor = 0.05;

        // tile gap control
        let xGap = gap != null ? gap * devicePixelRatio : Math.max(0, autoGapFactor * Math.min(xSize, ySize));
        let yGap = xGap;

        // clamp min tile size to 1px
        xSize = Math.max(1, Math.round(xSize - xGap));
        ySize = Math.max(1, Math.round(ySize - yGap));

        // bucket agg direction
        // let xCeil = false;
        // let yCeil = false;

        let xOffset = xCeil ? -xSize : 0;
        let yOffset = yCeil ? 0 : -ySize;

        // pre-compute x and y offsets
        let cys = ys.slice(0, yBinQty).map((y) => Math.round(valToPosY(y, scaleY, yDim, yOff) + yOffset));
        let cxs = Array.from({ length: xBinQty }, (v, i) =>
          Math.round(valToPosX(xs[i * yBinQty], scaleX, xDim, xOff) + xOffset)
        );

        for (let i = 0; i < dlen; i++) {
          // filter out 0 counts and out of view
          if (
            counts[i] > hideThreshold &&
            xs[i] + xBinIncr >= scaleX.min! &&
            xs[i] - xBinIncr <= scaleX.max! &&
            ys[i] + yBinIncr >= scaleY.min! &&
            ys[i] - yBinIncr <= scaleY.max!
          ) {
            let cx = cxs[~~(i / yBinQty)];
            let cy = cys[i % yBinQty];

            let fillPath = fillPaths[fills[i]];

            rect(fillPath, cx, cy, xSize, ySize);

            each(u, 1, i, cx, cy, xSize, ySize);
          }
        }

        u.ctx.save();
        //	u.ctx.globalAlpha = 0.8;
        u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
        u.ctx.clip();
        fillPaths.forEach((p, i) => {
          u.ctx.fillStyle = fillPalette[i];
          u.ctx.fill(p);
        });
        u.ctx.restore();

        return null;
      }
    );
  };
}

export const countsToFills = (u: uPlot, seriesIdx: number, palette: string[]) => {
  let counts = u.data[seriesIdx][2] as unknown as number[];

  // TODO: integrate 1e-9 hideThreshold?
  const hideThreshold = 0;

  let minCount = Infinity;
  let maxCount = -Infinity;

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > hideThreshold) {
      minCount = Math.min(minCount, counts[i]);
      maxCount = Math.max(maxCount, counts[i]);
    }
  }

  let range = maxCount - minCount;

  let paletteSize = palette.length;

  let indexedFills = Array(counts.length);

  for (let i = 0; i < counts.length; i++) {
    indexedFills[i] =
      counts[i] === 0 ? -1 : Math.min(paletteSize - 1, Math.floor((paletteSize * (counts[i] - minCount)) / range));
  }

  return indexedFills;
};

export const getHeatmapFrames = (dataFrame: DataFrame): Array<Field | undefined> => {
  const xField: Field | undefined = dataFrame.fields.find((f) => f.name === 'xMin');
  const yField: Field | undefined = dataFrame.fields.find((f) => f.name === 'yMin');
  const countField: Field | undefined = dataFrame.fields.find((f) => f.name === 'count');

  return [xField, yField, countField];
};

export const getHeatmapArrays = (dataFrame: DataFrame): Array<number[] | undefined> => {
  const [xField, yField, countField] = getHeatmapFrames(dataFrame);
  return [xField?.values.toArray(), yField?.values.toArray(), countField?.values.toArray()];
};

export const getDataMapping = (heatmapData: HeatmapData, origData: DataFrame): Array<number[] | null> => {
  const [xs, ys, counts] = getHeatmapArrays(heatmapData.heatmap!);
  const xos: number[] | undefined = origData.fields.find((f: Field) => f.type === 'time')?.values.toArray();
  const yos: number[] | undefined = origData.fields.find((f: Field) => f.type === 'number')?.values.toArray();

  if (xs && ys && counts && xos && yos) {
    const mapping: Array<number[] | null> = new Array(counts.length).fill(null);
    const xsmin = xs[0];
    const yosmin = Math.min(...yos);
    xos.forEach((xo: number, yoindex: number) => {
      const yo = yos[yoindex];
      const xsrow = Math.floor((xo - xsmin) / heatmapData.xBucketSize!);
      const yscol = Math.floor((yo - yosmin) / heatmapData.yBucketSize!);
      const index = xsrow * heatmapData.yBucketCount! + yscol;
      const count = counts[index];
      if (!mapping[index] && count > 0) {
        mapping[index] = [];
      }
      mapping[index]?.push(yoindex);
    });
    return mapping;
  }
  return [null];
};

export const resolveMappingToData = (data: DataFrame, indicies: number[] | null): DataFrame[] => {
  if (indicies === null) {
    return [];
  }
  console.log('dataframe', data, 'indicies', indicies);

  return indicies.map((index: number, i: number) => {
    return {
      name: `${i + 1}`,
      fields: data.fields.map((f: Field) => {
        return {
          ...f,
          values: new ArrayVector([f.values.get(index)]),
          length: 1,
        };
      }),
      length: data.fields.length,
    };
  });
};

export const findExemplarFrameInPanelData = (data: PanelData): DataFrame | undefined => {
  if (data.annotations) {
    let e = data.annotations.find((frame: DataFrame) => frame.meta?.custom?.resultType === 'exemplar');
    const colorSeries: DataFrame[] | undefined = data.series.map((s) => {
      return {
        ...s,
        fields: s.fields.filter((f) => f.config.color && f.type === 'time'),
      };
    });
    if (e && colorSeries?.length > 0 && colorSeries[0].fields.length === 1) {
      return {
        ...e,
        fields: e.fields.map((f) => {
          return {
            ...f,
            config: {
              ...f.config,
              color: colorSeries?.[0].fields[0].config.color,
            },
          };
        }),
      };
    }

    return undefined;
  }

  if (data.series) {
    return data.series.find((frame: DataFrame) => frame.meta?.custom?.resultType === 'exemplar');
  }

  return undefined;
};

export const findDataFramesInPanelData = (data: PanelData): DataFrame[] | undefined => {
  return data.series?.filter((frame: DataFrame) => frame.meta?.custom?.resultType !== 'exemplar');
};

export const timeFormatter = (value: number, timeZone: TimeZone) => {
  return dateTimeFormat(value, {
    format: systemDateFormats.fullDate,
    timeZone,
  });
};

export const translateMatrixIndex = (index: number, bucketCountFrom: number, bucketCountTo: number): number => {
  const row = Math.floor(index / bucketCountFrom);
  const column = index % bucketCountFrom;
  if (column >= bucketCountTo) {
    return -1;
  }

  return row * bucketCountTo + Math.floor(column / bucketCountTo) + (column % bucketCountTo);
};

export const lookupDataInCell = (
  lookupRange: HeatmapLookup,
  lookupData: DataFrame,
  onSplitOpen: SplitOpen | undefined,
  timeRange: TimeRange,
  timeZone: TimeZone
): DataFrame[] | undefined => {
  const timeField: Field | undefined = lookupData.fields.find((f: Field) => f.type === 'time');
  const valueField: Field | undefined = lookupData.fields.find((f: Field) => f.type === 'number');
  if (timeField && valueField) {
    const minIndex: number = timeField.values.toArray().findIndex((value: number) => value >= lookupRange.xRange.min!);
    const count: number = timeField.values
      .toArray()
      .slice(minIndex)
      .findIndex((value: number) => value >= lookupRange.xRange.max!);

    // Now find the relevant values in the value field.
    const indicies: number[] = valueField.values
      .toArray()
      .slice(minIndex, minIndex + count)
      .reduce((tally: number[], curr: number, i: number) => {
        if (curr >= lookupRange.yRange?.min! && curr < lookupRange.yRange?.max!) {
          tally.push(i + minIndex);
        }
        return tally;
      }, []);

    return indicies.map((annotationIndex: number, index: number) => {
      return {
        name: `${index + 1}`,
        fields: (lookupData.fields || []).map((f: Field, rowIndex: number) => {
          const newField: Field = {
            ...f,
            values: new ArrayVector([f.values.get(annotationIndex)]),
          };
          if (f.config.links?.length) {
            // We have links to configure. Add a getLinks function to the field
            newField.getLinks = (config: ValueLinkConfig) => {
              return getFieldLinksForExplore({ field: f, rowIndex, splitOpenFn: onSplitOpen, range: timeRange });
            };
          }
          if (f.type === 'time') {
            newField.display = (value: number) => {
              return {
                numeric: value,
                text: timeFormatter(value, timeZone),
              };
            };
          }
          return newField;
        }),
        length: 1,
      };
    });
  }
  return undefined;
};
