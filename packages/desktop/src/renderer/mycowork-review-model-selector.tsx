/**
 * 文件：packages/desktop/src/renderer/mycowork-review-model-selector.tsx
 * 职责：复用宿主模型清单与选择器，为Reviewer提供当前会话的显式选择。
 * 边界：只选择已配置可用模型；不保存全局默认，不传递provider凭据。
 * 关联：PR10 E1；renderer/mycowork-reviews.tsx。
 */
import React, { useMemo } from 'react';
import { Button, Dropdown, Menu } from '@arco-design/web-react';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import {
  RuntimeSelectorModelList,
  type RuntimeSelectorModelGroup,
} from '@/renderer/components/agent/runtimeSelectorOptions';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import { getAvailableModels } from '@/renderer/pages/guid/utils/modelUtils';

export type ReviewModel = { id: string; use_model: string };
type Choice = ReviewModel & { providerName: string };
const key = (model: ReviewModel) => `${model.id}::${model.use_model}`;

export function safeModel(model: ReviewModel | undefined): TProviderWithModel {
  if (!model?.id?.trim() || !model.use_model?.trim()) throw new Error('review_model_unavailable');
  return { id: model.id, use_model: model.use_model, platform: '', name: '', base_url: '', api_key: '' };
}

function ModelSelector({
  choices,
  current,
  disabled,
  label,
  onSelect,
}: {
  choices: Choice[];
  current: ReviewModel | undefined;
  disabled: boolean;
  label: string;
  onSelect: (model: ReviewModel) => void;
}) {
  const groups = new Map<string, RuntimeSelectorModelGroup>();
  for (const choice of choices) {
    if (!groups.has(choice.id)) groups.set(choice.id, { key: choice.id, title: choice.providerName, models: [] });
    groups.get(choice.id)!.models.push({ id: key(choice), label: choice.use_model });
  }
  return (
    <Dropdown
      disabled={disabled || choices.length === 0}
      trigger='click'
      droplist={
        <Menu>
          <RuntimeSelectorModelList
            groups={[...groups.values()]}
            currentModelId={current ? key(current) : null}
            disabled={disabled}
            onSelect={(id) => {
              const choice = choices.find((item) => key(item) === id);
              if (!disabled && choice) onSelect({ id: choice.id, use_model: choice.use_model });
            }}
          />
        </Menu>
      }
    >
      <Button disabled={disabled || choices.length === 0} aria-label={label} data-testid='review-model-selector'>
        {current?.use_model || label}
      </Button>
    </Dropdown>
  );
}

function choicesFrom(providers: IProvider[]): Choice[] {
  return providers
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) =>
      getAvailableModels(provider).map((model) => ({ id: provider.id, use_model: model, providerName: provider.name }))
    );
}

/** 选择状态来自宿主hook；创建前重新核对当前候选，显式选择只保留在本组件。 */
export function useReviewModelSelector() {
  const { current_model, modelList, setCurrentModel } = useGuidModelSelection('aionrs');
  const choices = useMemo(() => choicesFrom(modelList), [modelList]);
  const current = current_model ? { id: current_model.id, use_model: current_model.use_model || '' } : choices[0];
  return {
    selected(): ReviewModel {
      const choice = current && choices.find((item) => item.id === current.id && item.use_model === current.use_model);
      if (!choice) throw new Error('review_model_unavailable');
      return { id: choice.id, use_model: choice.use_model };
    },
    renderModelSelector: ({ disabled, label }: { disabled: boolean; label: string }) => (
      <ModelSelector
        choices={choices}
        current={current}
        disabled={disabled}
        label={label}
        onSelect={(model) => {
          void setCurrentModel(safeModel(model), { persistPreference: false });
        }}
      />
    ),
  };
}
