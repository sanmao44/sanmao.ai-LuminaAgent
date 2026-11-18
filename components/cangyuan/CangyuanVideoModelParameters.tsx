'use client';

import { useId } from 'react';
import SelectMenu from '@/components/SelectMenu';
import type { CangyuanVideoModelSpec, CangyuanVideoParameterSpec, VideoModelParameterValue, VideoModelParameterValues } from '@/packages/contracts/video-generation';
import { cangyuanVideoParameterDescription, cangyuanVideoParameterLabel, getCangyuanVideoAdvancedParameters } from '@/lib/cangyuan-video-model-catalog';
import styles from './CangyuanVideoModelParameters.module.css';

type Props = {
  spec: CangyuanVideoModelSpec;
  values: VideoModelParameterValues;
  onChange: (values: VideoModelParameterValues) => void;
};

const LONG_TEXT_PARAMETERS = new Set([
  'character_bible', 'custom_skill', 'custom_style', 'negative_prompt', 'script', 'storyboard', 'style',
]);

function valueList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item) => item.trim().length > 0);
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function setParameterValue(
  values: VideoModelParameterValues,
  name: string,
  value: VideoModelParameterValue | undefined,
): VideoModelParameterValues {
  const next = { ...values };
  if (value === undefined || value === '' || Array.isArray(value) && value.length === 0) delete next[name];
  else next[name] = value;
  return next;
}

function ModelParameterField({
  parameter,
  value,
  onValueChange,
  listId,
}: {
  parameter: CangyuanVideoParameterSpec;
  value: VideoModelParameterValue | undefined;
  onValueChange: (value: VideoModelParameterValue | undefined) => void;
  listId: string;
}) {
  const label = cangyuanVideoParameterLabel(parameter);
  const help = cangyuanVideoParameterDescription(parameter);
  const enumValues = valueList(parameter.enum);
  const suggestions = valueList(parameter.suggestions);

  if (parameter.name === 'mute_voice' && parameter.type === 'string') {
    const selected = typeof value === 'string' ? value : '';
    return <label className={styles.field}>
      <span>{label}{parameter.required ? <b>必填</b> : null}</span>
      <SelectMenu
        value={selected}
        onChange={(next) => onValueChange(next || undefined)}
        options={[
          { value: '', label: '正常配音（默认）' },
          { value: 'true', label: '人物静音' },
          { value: 'false', label: '明确关闭静音' },
        ]}
        ariaLabel={label}
      />
      {help && <small>{help}</small>}
    </label>;
  }

  if (parameter.type === 'boolean') {
    const selected = typeof value === 'boolean' ? value : undefined;
    return <label className={styles.booleanField}>
      <span>{label}{parameter.required ? <b>必填</b> : null}</span>
      <SelectMenu
        value={selected === undefined ? '' : String(selected)}
        onChange={(next) => onValueChange(next === '' ? undefined : next === 'true')}
        options={[
          { value: '', label: '使用模型默认' },
          { value: 'true', label: '开启' },
          { value: 'false', label: '关闭' },
        ]}
        ariaLabel={label}
      />
      {help && <small>{help}</small>}
    </label>;
  }

  if (enumValues.length) {
    const selected = typeof value === 'string' ? value : '';
    return <label className={styles.field}>
      <span>{label}{parameter.required ? <b>必填</b> : null}</span>
      <SelectMenu
        value={selected}
        onChange={(next) => onValueChange(next || undefined)}
        options={[
          { value: '', label: '请选择' },
          ...enumValues.map((item) => ({ value: item, label: item })),
        ]}
        ariaLabel={label}
      />
      {help && <small>{help}</small>}
    </label>;
  }

  if (parameter.type === 'number') {
    const numericValue = typeof value === 'number' ? value : '';
    return <label className={styles.field}>
      <span>{label}{parameter.required ? <b>必填</b> : null}</span>
      <input
        type="number"
        min={parameter.minimum}
        max={parameter.maximum}
        step="any"
        value={numericValue}
        onChange={(event) => onValueChange(event.target.value === '' ? undefined : Number(event.target.value))}
        aria-label={label}
      />
      {help && <small>{help}</small>}
    </label>;
  }

  if (parameter.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return <label className={`${styles.field} ${styles.wideField}`}>
      <span>{label}{parameter.required ? <b>必填</b> : null}</span>
      <textarea
        rows={3}
        maxLength={parameter.maxLength}
        value={items.join('\n')}
        onChange={(event) => onValueChange(event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))}
        aria-label={label}
        placeholder="每行填写一项"
      />
      {help && <small>{help}{parameter.maxItems ? ` 最多 ${parameter.maxItems} 项。` : ''}</small>}
    </label>;
  }

  const stringValue = typeof value === 'string' ? value : '';
  const isLongText = LONG_TEXT_PARAMETERS.has(parameter.name);
  const inputType = parameter.name.endsWith('_url') ? 'url' : 'text';
  return <label className={`${styles.field} ${isLongText ? styles.wideField : ''}`}>
    <span>{label}{parameter.required ? <b>必填</b> : null}</span>
    {isLongText ? <textarea
      rows={3}
      minLength={parameter.minLength}
      maxLength={parameter.maxLength}
      value={stringValue}
      onChange={(event) => onValueChange(event.target.value || undefined)}
      aria-label={label}
      placeholder={parameter.name === 'script' || parameter.name === 'storyboard' ? '在这里填写内容' : '可留空，按提示词或模型默认生成'}
    /> : <input
      type={inputType}
      minLength={parameter.minLength}
      maxLength={parameter.maxLength}
      list={suggestions.length ? listId : undefined}
      value={stringValue}
      onChange={(event) => onValueChange(event.target.value || undefined)}
      aria-label={label}
      placeholder={suggestions.length ? '可输入或选择建议值' : '可选'}
    />}
    {suggestions.length > 0 && <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist>}
    {help && <small>{help}</small>}
  </label>;
}

export default function CangyuanVideoModelParameters({ spec, values, onChange }: Props) {
  const id = useId();
  const parameters = getCangyuanVideoAdvancedParameters(spec);
  if (!parameters.length) return null;

  return <section className={styles.panel} aria-label="当前型号的更多设置">
    <div className={styles.heading}>
      <strong>更多设置</strong>
      <small>只显示当前型号文档支持的选项</small>
    </div>
    <div className={styles.grid}>
      {parameters.map((parameter) => <ModelParameterField
        key={parameter.name}
        parameter={parameter}
        value={values[parameter.name]}
        listId={`${id}-${parameter.name}`}
        onValueChange={(value) => onChange(setParameterValue(values, parameter.name, value))}
      />)}
    </div>
  </section>;
}
