import { CompactSelection, GridCell, GridCellKind } from '@glideapps/glide-data-grid';

import {
  ArrayVector,
  DataFrame,
  DataFrameJSON,
  dataFrameToJSON,
  DatagridDataChangeEvent,
  MutableDataFrame,
  Field,
} from '@grafana/data';
import { config } from '@grafana/runtime';
import { getDashboardSrv } from 'app/features/dashboard/services/DashboardSrv';
import { GrafanaQuery, GrafanaQueryType } from 'app/plugins/datasource/grafana/types';

const ICON_AND_MENU_WIDTH = 30;

export const EMPTY_DF = {
  name: 'A',
  fields: [],
  length: 0,
};

export const GRAFANA_DS = {
  type: 'grafana',
  uid: 'grafana',
};

export const EMPTY_CELL: GridCell = {
  kind: GridCellKind.Text,
  data: '',
  allowOverlay: true,
  readonly: false,
  displayData: '',
};

export const EMPTY_GRID_SELECTION = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
};

export const TRAILING_ROW_OPTIONS = {
  sticky: false,
  tint: true,
};

export const RIGHT_ELEMENT_PROPS = {
  fill: true,
  sticky: false,
};

export interface DatagridContextMenuData {
  x?: number;
  y?: number;
  column?: number;
  row?: number;
  isHeaderMenu?: boolean;
  isContextMenuOpen: boolean;
}

export interface RenameColumnInputData {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isInputOpen: boolean;
  inputValue?: string;
  columnIdx?: number;
}

interface CellRange {
  x: number;
  y: number;
  width: number;
  height: number;
}

//TODO: not sure about the fontSize param. need to check and see if it's the right one
export const getCellWidth = (field: Field, fontSize: number): number => {
  return Math.max(
    field.name.length * fontSize + ICON_AND_MENU_WIDTH, //header text
    field.values
      .toArray()
      .reduce(
        (acc: number, val: string | number) => (val?.toString().length > acc ? (acc = val?.toString().length) : acc),
        0
      ) * fontSize //cell text
  );
};

export const deleteRows = (gridData: DataFrame, rows: number[], hardDelete = false): DataFrame => {
  for (const field of gridData.fields) {
    const valuesArray = field.values.toArray();

    //delete from the end of the array to avoid index shifting
    for (let i = rows.length - 1; i >= 0; i--) {
      if (hardDelete) {
        valuesArray.splice(rows[i], 1);
      } else {
        valuesArray.splice(rows[i], 1, null);
      }
    }

    field.values = new ArrayVector(valuesArray);
  }

  return new MutableDataFrame(gridData);
};

export const clearCellsFromRangeSelection = (gridData: DataFrame, range: CellRange): DataFrame => {
  const colFrom: number = range.x;
  const rowFrom: number = range.y;
  const colTo: number = range.x + range.width - 1;

  for (let i = colFrom; i <= colTo; i++) {
    const field = gridData.fields[i];

    const valuesArray = field.values.toArray();
    valuesArray.splice(rowFrom, range.height, ...new Array(range.height).fill(null));
    field.values = new ArrayVector(valuesArray);
  }

  return new MutableDataFrame(gridData);
};

export const publishSnapshot = (data: DataFrame, panelID: number): void => {
  const snapshot: DataFrameJSON[] = [dataFrameToJSON(data)];
  const dashboard = getDashboardSrv().getCurrent();
  const panelModel = dashboard?.getPanelById(panelID);

  if (dashboard?.panelInEdit?.id === panelID) {
    dashboard?.events.publish({
      type: DatagridDataChangeEvent.type,
      payload: {
        snapshot,
      },
    });
  }

  const query: GrafanaQuery = {
    refId: 'A',
    queryType: GrafanaQueryType.Snapshot,
    snapshot,
    datasource: GRAFANA_DS,
  };

  panelModel!.updateQueries({
    dataSource: GRAFANA_DS,
    queries: [query],
  });

  panelModel!.refresh();
};

export const isDatagridEditEnabled = () => {
  return config.featureToggles.enableDatagridEditingPanel;
};

//Converting an array of nulls or undefineds returns them as strings and prints them in the cells instead of empty cells. Thus the cleanup func
export const cleanStringFieldAfterConversion = (field: Field): void => {
  const valuesArray = field.values.toArray();
  field.values = new ArrayVector(valuesArray.map((val) => (val === 'undefined' || val === 'null' ? null : val)));
  return;
};
