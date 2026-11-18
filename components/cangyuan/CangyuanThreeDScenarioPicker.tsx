'use client';

import { useMemo, useState } from 'react';
import { cangyuanThreeDScenarios, type CangyuanThreeDScenario } from './three-d-presets';

export default function CangyuanThreeDScenarioPicker({
  modelId,
  onApply,
}: {
  modelId: string;
  onApply: (scenario: CangyuanThreeDScenario) => void;
}) {
  const scenarios = useMemo(() => cangyuanThreeDScenarios(modelId), [modelId]);
  const [selectedId, setSelectedId] = useState('');

  if (!scenarios.length) return null;

  const selected = scenarios.find((scenario) => scenario.id === selectedId);

  return (
    <section className="cangyuan-3d-scenarios" aria-label="三维场景预设">
      <div className="cangyuan-3d-scenario-heading"><b>从使用场景开始</b><span>应用后仍可手动调整</span></div>
      <div className="cangyuan-3d-scenario-list" role="group" aria-label="选择三维场景预设">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            aria-pressed={selectedId === scenario.id}
            className={selectedId === scenario.id ? 'active' : ''}
            onClick={() => {
              setSelectedId(scenario.id);
              onApply(scenario);
            }}
          >
            {scenario.label}
          </button>
        ))}
      </div>
      {selected && <p className="cangyuan-3d-scenario-guidance" role="status">{selected.guidance}</p>}
    </section>
  );
}
