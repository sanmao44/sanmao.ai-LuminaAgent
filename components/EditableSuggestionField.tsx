'use client';

import SelectMenu from './SelectMenu';
import './EditableSuggestionField.css';

type Props = {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
  optionLabel?: (value: string) => string;
  customLabel?: string;
};

/** A platform-styled suggestion picker that keeps arbitrary values editable. */
export default function EditableSuggestionField({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  optionLabel = (option) => option,
  customLabel = '自定义',
}: Props) {
  const normalizedOptions = options.filter((option, index) => option && options.indexOf(option) === index);
  const isSuggested = normalizedOptions.includes(value);
  const selectValue = isSuggested ? value : '__custom__';
  const selectOptions = [
    ...normalizedOptions.map((option) => ({ value: option, label: optionLabel(option) })),
    { value: '__custom__', label: customLabel },
  ];

  return (
    <div className="editable-suggestion-field">
      <SelectMenu
        value={selectValue}
        options={selectOptions}
        ariaLabel={`${ariaLabel}预设`}
        onChange={(nextValue) => {
          if (nextValue === '__custom__') {
            if (isSuggested) onChange('');
            return;
          }
          onChange(nextValue);
        }}
      />
      {selectValue === '__custom__' && (
        <input
          type="text"
          inputMode="text"
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
