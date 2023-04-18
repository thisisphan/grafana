import { css, cx } from '@emotion/css';
import { noop } from 'lodash';
import React, { CSSProperties, useCallback, useEffect, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList } from 'react-window';

import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, clearButtonStyles, FilterInput, Icon, LoadingPlaceholder, Modal, useStyles2 } from '@grafana/ui';
import { AlertmanagerAlert } from 'app/plugins/datasource/alertmanager/types';
import { dispatch } from 'app/store/store';
import { RuleNamespace, Rule } from 'app/types/unified-alerting';

import { useUnifiedAlertingSelector } from '../../hooks/useUnifiedAlertingSelector';
import { fetchPromRulesAction } from '../../state/actions';
import { GRAFANA_RULES_SOURCE_NAME } from '../../utils/datasource';
import { initialAsyncRequestState } from '../../utils/redux';

export function AlertInstanceModalSelector({ onSelect }: { onSelect: (payload: string) => void }) {
  const styles = useStyles2(getStyles);

  const [selectedRule, setSelectedRule] = useState(null);
  const [selectedInstance, setSelectedInstance] = useState(null);

  const promRuleRequests = useUnifiedAlertingSelector((state) => state.promRules);

  const { loading, result, error } = promRuleRequests[GRAFANA_RULES_SOURCE_NAME] || initialAsyncRequestState;

  useEffect(() => {
    dispatch(fetchPromRulesAction({ rulesSourceName: GRAFANA_RULES_SOURCE_NAME }));
  }, []);

  if (error) {
    return null;
  }

  const rulesWithInstances: Rule[] = [];

  if (!loading && result) {
    result.forEach((rule: RuleNamespace) => {
      rule.groups.forEach((group) => {
        group.rules.forEach((r) => {
          rulesWithInstances.push(r);
        });
      });
    });
  }

  const RuleRow = ({ index, style }: { index: number; style?: CSSProperties }) => {
    const rule = rulesWithInstances[index];

    const isSelected = false; //selectedRule === dashboard.uid;

    return (
      <button
        type="button"
        title={rule?.name}
        style={style}
        className={cx(styles.rowButton, { [styles.rowOdd]: index % 2 === 1, [styles.rowSelected]: isSelected })}
        onClick={() => noop}
      >
        <div className={cx(styles.dashboardTitle, styles.rowButtonTitle)}>{rule?.name}</div>
      </button>
    );
  };

  const InstanceRow = () => {
    return null;
  };

  const parseAsPayload = (instances: Array<SelectableValue<AlertmanagerAlert>>) => {
    return JSON.stringify(
      {
        alerts: instances.map(({ value }) => ({
          annotations: value?.annotations,
          labels: value?.labels,
          startsAt: value?.startsAt,
          endsAt: value?.endsAt,
        })),
      },
      null,
      2
    );
  };

  const handleSelectedInstance = (instances: Array<SelectableValue<AlertmanagerAlert>>) => {
    const payload = parseAsPayload(instances);
    onSelect(payload);
  };

  return (
    <div className={''}>
      <h5>Alert instances</h5>
      <Modal
        title="Select alert instance"
        closeOnEscape
        isOpen={true}
        onDismiss={noop}
        className={''}
        contentClassName={''}
      >
        <div className={styles.container}>
          <FilterInput value={''} onChange={noop} title="Search alert rule" placeholder="Search alert rule" autoFocus />
          <FilterInput value={''} onChange={noop} title="Search alert instance" placeholder="Search alert instance" />

          <div className={styles.column}>
            {loading && <LoadingPlaceholder text="Loading rules..." className={styles.loadingPlaceholder} />}

            {!loading && (
              <AutoSizer>
                {({ height, width }) => (
                  <FixedSizeList itemSize={50} height={height} width={width} itemCount={10}>
                    {RuleRow}
                  </FixedSizeList>
                )}
              </AutoSizer>
            )}
          </div>

          <div className={styles.column}>
            {!selectedRule && !loading && (
              <div className={styles.selectDashboardPlaceholder}>
                <div>Select a alert rule to get a list of available instances</div>
              </div>
            )}
            {loading && <LoadingPlaceholder text="Loading rule..." className={styles.loadingPlaceholder} />}

            {selectedRule && !loading && (
              <AutoSizer>
                {({ width, height }) => (
                  <FixedSizeList itemSize={32} height={height} width={width} itemCount={10}>
                    {InstanceRow}
                  </FixedSizeList>
                )}
              </AutoSizer>
            )}
          </div>
        </div>
        <Modal.ButtonRow>
          <Button type="button" variant="secondary" onClick={noop}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!(selectedRule && selectedInstance)}
            onClick={() => {
              if (selectedRule && selectedInstance) {
                //onChange(selectedRule, selectedInstance);
              }
            }}
          >
            Confirm
          </Button>
        </Modal.ButtonRow>
      </Modal>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  const clearButton = clearButtonStyles(theme);

  return {
    container: css`
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: min-content auto;
      gap: ${theme.spacing(2)};
      flex: 1;
    `,
    column: css`
      flex: 1 1 auto;
    `,
    dashboardTitle: css`
      height: 22px;
      font-weight: ${theme.typography.fontWeightBold};
    `,
    dashboardFolder: css`
      height: 20px;
      font-size: ${theme.typography.bodySmall.fontSize};
      color: ${theme.colors.text.secondary};
      display: flex;
      flex-direction: row;
      justify-content: flex-start;
      column-gap: ${theme.spacing(1)};
      align-items: center;
    `,
    rowButton: css`
      ${clearButton};
      padding: ${theme.spacing(0.5)};
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      border: 2px solid transparent;

      &:disabled {
        cursor: not-allowed;
        color: ${theme.colors.text.disabled};
      }
    `,
    rowButtonTitle: css`
      text-overflow: ellipsis;
      overflow: hidden;
    `,
    rowSelected: css`
      border-color: ${theme.colors.primary.border};
    `,
    rowOdd: css`
      background-color: ${theme.colors.background.secondary};
    `,
    panelButton: css`
      display: flex;
      gap: ${theme.spacing(1)};
      justify-content: space-between;
      align-items: center;
    `,
    loadingPlaceholder: css`
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    `,
    selectDashboardPlaceholder: css`
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
      font-weight: ${theme.typography.fontWeightBold};
    `,
    modal: css`
      height: 100%;
    `,
    modalContent: css`
      flex: 1;
      display: flex;
      flex-direction: column;
    `,
    modalAlert: css`
      flex-grow: 0;
    `,
    warnIcon: css`
      fill: ${theme.colors.warning.main};
    `,
  };
};
