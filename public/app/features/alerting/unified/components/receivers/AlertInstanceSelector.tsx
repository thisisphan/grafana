import { css } from '@emotion/css';
import React, { useCallback, useEffect } from 'react';

import { SelectableValue } from '@grafana/data';
import { MultiSelect, useStyles2 } from '@grafana/ui';
import { AlertmanagerAlert } from 'app/plugins/datasource/alertmanager/types';
import { dispatch } from 'app/store/store';

import { useUnifiedAlertingSelector } from '../../hooks/useUnifiedAlertingSelector';
import { fetchAmAlertsAction } from '../../state/actions';
import { GRAFANA_RULES_SOURCE_NAME } from '../../utils/datasource';
import { initialAsyncRequestState } from '../../utils/redux';

export function AlertInstanceSelector({ onSelect }: { onSelect: (payload: string) => void }) {
  const styles = useStyles2(getStyles);

  const alertsRequests = useUnifiedAlertingSelector((state) => state.amAlerts);
  const { loading, result, error } = alertsRequests[GRAFANA_RULES_SOURCE_NAME] || initialAsyncRequestState;

  useEffect(() => {
    dispatch(fetchAmAlertsAction(GRAFANA_RULES_SOURCE_NAME));
  }, []);

  const getOptions = useCallback(() => {
    if (!result || !result.length) {
      return [];
    }

    return result.map((instance) => {
      const label = `${instance.labels['alertname']} (${instance.labels['grafana_folder']})`;
      const value = instance;
      return { label, value };
    });
  }, [result]);

  if (error) {
    return null;
  }

  const options = getOptions();

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
    <div className={styles.selectContainer}>
      <h5>Alert instances</h5>
      <MultiSelect
        isLoading={loading}
        disabled={false}
        data-testid={'alert-instance-picker'}
        inputId={'alert-instance-picker'}
        width={100}
        isClearable={true}
        backspaceRemovesValue={true}
        onChange={handleSelectedInstance}
        virtualized={true}
        options={options}
        maxMenuHeight={500}
        placeholder={'Select alert instaces to add to your payload'}
        noOptionsMessage="No alert instances found"
        getOptionLabel={(option) => {
          return option.label || '';
        }}
      />
    </div>
  );
}

const getStyles = () => ({
  selectContainer: css`
    width: 605px;
  `,
});
