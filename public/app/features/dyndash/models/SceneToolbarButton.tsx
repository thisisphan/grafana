import React from 'react';

import { IconName, Input, ToolbarButton } from '@grafana/ui';

import { SceneObjectBase } from './SceneObjectBase';
import { SceneComponentProps, SceneObjectState } from './types';

export interface ToolbarButtonState extends SceneObjectState {
  icon: IconName;
  onClick: () => void;
}

export class SceneToolbarButton extends SceneObjectBase<ToolbarButtonState> {
  Component = ({ model }: SceneComponentProps<SceneToolbarButton>) => {
    const state = model.useState();

    return <ToolbarButton onClick={state.onClick} icon={state.icon} />;
  };
}

export interface SceneToolbarInputState extends SceneObjectState {
  value?: string;
  onChange: (value: number) => void;
}

export class SceneToolbarInput extends SceneObjectBase<SceneToolbarInputState> {
  Component = ({ model }: SceneComponentProps<SceneToolbarInput>) => {
    const state = model.useState();

    return (
      <Input
        defaultValue={state.value}
        onBlur={(evt) => {
          model.state.onChange(parseInt(evt.currentTarget.value, 10));
        }}
      />
    );
  };
}
