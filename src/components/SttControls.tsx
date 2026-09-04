import { createSignal, For, onMount, onCleanup, createEffect, type Component } from 'solid-js';
import { MappingItem, type HabitSourceKind } from './MappingItem';
import type { SttStore } from '../stores/sttStore';
import type { ConversionMapping } from '../schemas/uhabits';
import { Plus } from 'lucide-solid';

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
	};

	const emitMappings = () => {
		const current = collectMappings();
		setValidMappingCount(current.length);
		props.onMappingsChange(current);
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
			emitMappings();
		}, 0);
	});

	const canConvert = () => {
		const hasSource = props.sourceKind === 'timejot'
			? props.sttStore.timeJotData() && props.sttStore.timeJotFile()
			: props.sttStore.sttData() && props.sttStore.sttFile();
		return hasSource && props.sttStore.uhabitsData() && props.sttStore.uhabitsFile() && validMappingCount() > 0;
	};

	return (
		<section id="action-stt-uhabits-fill" class="import-workspace">
			<div class="section-heading">
				<div><span class="eyebrow">Backfill habits</span><h2>{props.sourceKind === 'timejot' ? 'TimeJot to Loop Habit Tracker' : 'Simple Time Tracker to Loop Habit Tracker'}</h2></div>
				<p>Choose what maps where. Existing target dates are never overwritten.</p>
			</div>

			<div id="conversion-mappings">
				<div class="mapping-title-row"><h3>Mappings</h3><span>{mappings().length} configured</span></div>
				<div id="mapping-list">
					<For each={mappings()}>
						{(mapping) => (
							<MappingItem
								ref={(api: any) => mappingRefs.set(mapping.id, api)}
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
					<Plus size={17} /> Add another mapping
				</button>
			</div>

			<div class="controls">
				<button
					id="btn-convert-stt"
					disabled={props.disabled || !canConvert()}
					onClick={props.onConvert}
				>
					{props.disabled ? 'Building backup...' : 'Create filled backup'}
				</button>
			</div>
		</section>
	);
};
