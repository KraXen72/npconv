import { createSignal, For, onMount, onCleanup, createEffect, type Component } from 'solid-js';
import { MappingItem } from './MappingItem';
import type { SttStore } from '../stores/sttStore';
import type { ConversionMapping } from '../types/uhabits';

interface Props {
  disabled: boolean;
  sttStore: SttStore;
  onConvert: () => void;
  onMappingsChange: (mappings: ConversionMapping[]) => void;
}

interface MappingRef {
  id: number;
}

interface MappingItemApi {
  getMapping: () => ConversionMapping | null;
}

export const SttControls: Component<Props> = (props) => {
  const [mappings, setMappings] = createSignal<MappingRef[]>([]);
  const [nextId, setNextId] = createSignal(0);
  const mappingRefs = new Map<number, MappingItemApi>();

  // Add initial mapping
  onMount(() => {
    const timerId = setTimeout(() => addMapping(), 0);
    onCleanup(() => clearTimeout(timerId));
  });

  const addMapping = () => {
    const id = nextId();
    setNextId(id + 1);
    setMappings([...mappings(), { id }]);
  };

  const removeMapping = (id: number) => {
    mappingRefs.delete(id);
    setMappings(mappings().filter(m => m.id !== id));
  };

  // Collect current mappings from refs and emit to parent
  const collectMappings = () => {
    const result: ConversionMapping[] = [];
    for (const mapping of mappings()) {
      const api = mappingRefs.get(mapping.id);
      const data = api?.getMapping?.();
      if (data) {
        result.push(data);
      }
    }
    return result;
  };

  // Emit mappings whenever they might have changed
  createEffect(() => {
    // Track all dependencies that could affect mappings
    mappings();
    props.sttStore.sttData();
    props.sttStore.uhabitsData();
    
    // Small delay to ensure refs are populated after render
    setTimeout(() => {
      props.onMappingsChange(collectMappings());
    }, 0);
  });

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
                ref={(api: any) => mappingRefs.set(mapping.id, api)}
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
