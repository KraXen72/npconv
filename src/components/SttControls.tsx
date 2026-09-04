import { createSignal, For, onMount, onCleanup, createEffect, type Component } from 'solid-js';
import { MappingItem, type HabitSourceKind } from './MappingItem';
import type { SttStore } from '../stores/sttStore';
import type { ConversionMapping } from '../schemas/uhabits';

interface Props {
  disabled: boolean;
  sttStore: SttStore;
  onConvert: () => void;
  onMappingsChange: (mappings: ConversionMapping[]) => void;
  sourceKind: HabitSourceKind;
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
  const [validMappingCount, setValidMappingCount] = createSignal(0);
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
    queueMicrotask(emitMappings);
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

  const emitMappings = () => {
    const result = collectMappings();
    setValidMappingCount(result.length);
    props.onMappingsChange(result);
  };

  // Emit mappings whenever they might have changed
  createEffect(() => {
    mappings();
    props.sttStore.sttData();
    props.sttStore.timeJotData();
    props.sttStore.uhabitsData();
    props.sourceKind;
    
    // Small delay to ensure refs are populated after render
    setTimeout(emitMappings, 0);
  });

  const canConvert = () => {
    const hasSource = props.sourceKind === 'timejot'
      ? props.sttStore.timeJotData() && props.sttStore.timeJotFile()
      : props.sttStore.sttData() && props.sttStore.sttFile();

    return hasSource && props.sttStore.uhabitsData() && props.sttStore.uhabitsFile() &&
      validMappingCount() > 0;
  };

  return (
    <section id="action-stt-uhabits-fill" class="controls-block">
      <h3>{props.sourceKind === 'timejot' ? 'TimeJot → uHabits: Fill' : 'SimpleTimeTracker → uHabits: Fill'}</h3>

      <div id="conversion-mappings">
        <h4>{props.sourceKind === 'timejot' ? 'Event Mappings' : 'Activity Mappings'}</h4>
        <div id="mapping-list">
          <For each={mappings()}>
            {(mapping) => (
              <MappingItem
                ref={(api: any) => {
                  if (api) mappingRefs.set(mapping.id, api);
                  else mappingRefs.delete(mapping.id);
                }}
                mappingId={mapping.id}
                sourceKind={props.sourceKind}
                sttData={props.sttStore.sttData()}
                timeJotData={props.sttStore.timeJotData()}
                uhabitsData={props.sttStore.uhabitsData()}
                onRemove={() => removeMapping(mapping.id)}
                onChange={emitMappings}
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
