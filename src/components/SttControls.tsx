import { createSignal, For, type Component } from 'solid-js';
import { MappingItem } from './MappingItem';
import type { SttStore } from '../stores/sttStore';

interface Props {
  disabled: boolean;
  sttStore: SttStore;
  onConvert: () => void;
}

interface MappingRef {
  id: number;
  ref: any;
}

export const SttControls: Component<Props> = (props) => {
  const [mappings, setMappings] = createSignal<MappingRef[]>([]);
  const [nextId, setNextId] = createSignal(0);

  // Add initial mapping
  setTimeout(() => addMapping(), 0);

  const addMapping = () => {
    const id = nextId();
    setNextId(id + 1);
    setMappings([...mappings(), { id, ref: null }]);
  };

  const removeMapping = (id: number) => {
    setMappings(mappings().filter(m => m.id !== id));
  };

  const canConvert = () => {
    return props.sttStore.sttData() && props.sttStore.uhabitsData() &&
      props.sttStore.sttFile() && props.sttStore.uhabitsFile() &&
      mappings().length > 0;
  };

  return (
    <section id="action-stt-uhabits-fill" class="controls-block">
      <h3>SimpleTimeTracker ⇌ uHabits: Fill</h3>

      <div id="conversion-mappings">
        <h4>Activity Mappings</h4>
        <div id="mapping-list">
          <For each={mappings()}>
            {(mapping) => (
              <MappingItem
                ref={(el: any) => (mapping.ref = el)}
                mappingId={mapping.id}
                sttData={props.sttStore.sttData()}
                uhabitsData={props.sttStore.uhabitsData()}
                onRemove={() => removeMapping(mapping.id)}
              />
            )}
          </For>
        </div>
        <button id="add-mapping" type="button" onClick={addMapping}>
          + Add Mapping
        </button>
      </div>

      <div class="controls">
        <button
          id="btn-convert-stt"
          disabled={props.disabled || !canConvert()}
          onClick={props.onConvert}
        >
          Fill
        </button>
      </div>
    </section>
  );
};
