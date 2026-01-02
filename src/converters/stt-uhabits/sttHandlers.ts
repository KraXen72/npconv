import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping, ParsedUHabitsBackup } from '../../types/uhabits';
import type { ParsedSttBackup } from '../../types/stt';
import { parseSttBackup, filterRecordsByDuration, groupRecordsByDay, getRecordsForType } from './sttParser';
import { parseUHabitsBackup, timestampToDayStart } from './uhabitsHelper';
import { convertSttToUHabits } from './toUHabits';
import { downloadFile } from '../../utils';
import { log } from '../../logger';

let sttData: ParsedSttBackup | null = null;
let uhabitsData: ParsedUHabitsBackup | null = null;
let nextMappingId = 0;

export function setupSttHandlers(SQL: SqlJsStatic) {
	const sttInput = document.getElementById('file-left') as HTMLInputElement | null;
	const uhabitsInput = document.getElementById('file-right') as HTMLInputElement | null;
	const addMappingBtn = document.getElementById('add-mapping') as HTMLButtonElement | null;
	const convertBtn = document.getElementById('btn-convert-stt') as HTMLButtonElement | null;

	if (!sttInput || !uhabitsInput || !addMappingBtn || !convertBtn) return;

	// File upload handlers
	sttInput.addEventListener('change', async () => {
		const file = sttInput.files?.[0];
		if (!file) return;
		
		try {
			sttData = await parseSttBackup(file);
			log(`Loaded ${sttData.recordTypes.size} STT activity types`, 'info');
			populateAllSttSelects();
			updateConvertButton();
		} catch (error: any) {
			log(`Error loading STT file: ${error.message}`, 'err');
			sttData = null;
		}
	});

	uhabitsInput.addEventListener('change', async () => {
		const file = uhabitsInput.files?.[0];
		if (!file) return;
		
		try {
			uhabitsData = await parseUHabitsBackup(file, SQL);
			log(`Loaded ${uhabitsData.habits.size} uHabits habits (boolean only)`, 'info');
			populateAllUHabitsSelects();
			updateConvertButton();
		} catch (error: any) {
			log(`Error loading uHabits file: ${error.message}`, 'err');
			uhabitsData = null;
		}
	});

	// Add mapping button
	addMappingBtn.addEventListener('click', () => addMapping());

	// Convert button
	convertBtn.addEventListener('click', async () => await performSttConversion(SQL));

	// Add first empty mapping
	addMapping();
}

function addMapping() {
	const mappingList = document.getElementById('mapping-list');
	if (!mappingList) return;

	const mappingId = nextMappingId++;

	const item = document.createElement('div');
	item.className = 'mapping-item';
	item.setAttribute('data-mapping-id', mappingId.toString());

	item.innerHTML = `
		<div class="mapping-selects">
			<select class="stt-activity-select" data-mapping-id="${mappingId}">
				<option value="">Select STT activity...</option>
			</select>
			<span class="mapping-arrow">→</span>
			<select class="uhabits-habit-select" data-mapping-id="${mappingId}">
				<option value="">Select uHabits habit...</option>
			</select>
			<label class="min-duration-label">
				Min:
				<input type="number" class="min-duration-input" value="5" min="0" step="1" title="Minimum duration in minutes">
				min
			</label>
			<button class="remove-mapping" aria-label="Remove mapping">×</button>
		</div>
		<div class="activity-grid-container" style="display: none;">
			<activity-grid class="habit-preview-grid" dark-mode></activity-grid>
		</div>
	`;

	mappingList.appendChild(item);

	// Populate selects if data is loaded
	const sttSelect = item.querySelector('.stt-activity-select') as HTMLSelectElement;
	const uhabitsSelect = item.querySelector('.uhabits-habit-select') as HTMLSelectElement;

	if (sttData) populateSttSelect(sttSelect);
	if (uhabitsData) populateUHabitsSelect(uhabitsSelect);

	// Add change listeners
	sttSelect.addEventListener('change', () => {
		updateActivityGrid(mappingId);
		updateSummary();
	});
	uhabitsSelect.addEventListener('change', () => {
		updateActivityGrid(mappingId);
		updateSummary();
	});

	// Min duration listener
	const minDurationInput = item.querySelector('.min-duration-input') as HTMLInputElement;
	if (minDurationInput) {
		minDurationInput.addEventListener('change', () => {
			updateActivityGrid(mappingId);
			updateSummary();
		});
	}

	// Remove button
	const removeBtn = item.querySelector('.remove-mapping') as HTMLButtonElement;
	removeBtn.addEventListener('click', () => {
		item.remove();
		updateSummary();
		updateConvertButton();
	});
}

function populateSttSelect(select: HTMLSelectElement) {
	if (!sttData) return;

	// Clear existing options except first
	select.innerHTML = '<option value="">Select STT activity...</option>';

	for (const [id, type] of sttData.recordTypes) {
		const option = document.createElement('option');
		option.value = id.toString();
		option.textContent = `${type.emoji} ${type.name} (id: ${id})`;
		select.appendChild(option);
	}
}

function populateUHabitsSelect(select: HTMLSelectElement) {
	if (!uhabitsData) return;

	// Clear existing options except first
	select.innerHTML = '<option value="">Select uHabits habit...</option>';

	// Separate active and archived habits
	const activeHabits: Array<[number, typeof uhabitsData.habits extends Map<any, infer T> ? T : never]> = [];
	const archivedHabits: Array<[number, typeof uhabitsData.habits extends Map<any, infer T> ? T : never]> = [];

	for (const [id, habit] of uhabitsData.habits) {
		if (habit.archived) {
			archivedHabits.push([id, habit]);
		} else {
			activeHabits.push([id, habit]);
		}
	}

	// Add active habits
	for (const [id, habit] of activeHabits) {
		const option = document.createElement('option');
		option.value = id.toString();
		option.textContent = `${habit.name} (id: ${id})`;
		select.appendChild(option);
	}

	// Add divider if there are archived habits
	if (archivedHabits.length > 0) {
		const divider = document.createElement('option');
		divider.disabled = true;
		divider.textContent = '─── Archived ───';
		divider.style.fontStyle = 'italic';
		divider.style.color = '#888';
		select.appendChild(divider);

		// Add archived habits
		for (const [id, habit] of archivedHabits) {
			const option = document.createElement('option');
			option.value = id.toString();
			option.textContent = `${habit.name} (id: ${id})`;
			option.style.fontStyle = 'italic';
			option.style.opacity = '0.7';
			select.appendChild(option);
		}
	}
}

function populateAllSttSelects() {
	document.querySelectorAll('.stt-activity-select').forEach(select => {
		populateSttSelect(select as HTMLSelectElement);
	});
}

function populateAllUHabitsSelects() {
	document.querySelectorAll('.uhabits-habit-select').forEach(select => {
		populateUHabitsSelect(select as HTMLSelectElement);
	});
}

function updateActivityGrid(mappingId: number) {
	const item = document.querySelector(`[data-mapping-id="${mappingId}"]`) as HTMLElement;
	if (!item || !sttData || !uhabitsData) return;

	const sttSelect = item.querySelector('.stt-activity-select') as HTMLSelectElement;
	const uhabitsSelect = item.querySelector('.uhabits-habit-select') as HTMLSelectElement;
	const gridContainer = item.querySelector('.activity-grid-container') as HTMLElement;
	const grid = item.querySelector('activity-grid') as any;

	const sttTypeId = parseInt(sttSelect.value);
	const uhabitsHabitId = parseInt(uhabitsSelect.value);

	if (!sttTypeId || !uhabitsHabitId) {
		gridContainer.style.display = 'none';
		return;
	}

	// Show grid
	gridContainer.style.display = 'block';

	// Get minimum duration
	const minDurationInput = document.getElementById('min-duration') as HTMLInputElement;
	const minDuration = minDurationInput ? parseInt(minDurationInput.value) || 0 : 0;

	// Get existing repetitions (gray)
	const existingData: any[] = [];
	const existingDates = new Set<string>();
	
	for (const rep of uhabitsData.repetitions) {
		if (rep.habit_id === uhabitsHabitId && rep.value > 0) {
			const date = new Date(rep.timestamp).toISOString().split('T')[0];
			existingDates.add(date);
			existingData.push({
				date,
				count: 1
			});
		}
	}

	// Get new repetitions from STT (primary color)
	const filteredRecords = filterRecordsByDuration(sttData.records, minDuration);
	const typeRecords = getRecordsForType(filteredRecords, sttTypeId);
	const dayGroups = groupRecordsByDay(typeRecords);

	const newData: any[] = [];
	for (const [dayStr, records] of dayGroups) {
		// Only add if not already exists
		if (!existingDates.has(dayStr)) {
			newData.push({
				date: dayStr,
				count: 2 // Higher count for primary color
			});
		}
	}

	// Combine data
	const allData = [...existingData, ...newData];

	// Set grid properties
	grid.data = allData;
	
	// Use a custom color scheme: gray for existing, primary for new
	const primaryColor = getComputedStyle(document.documentElement)
		.getPropertyValue('--primary').trim();
	
	grid.colors = ['#ebedf0', '#6b7280', primaryColor, primaryColor, primaryColor];
	grid.emptyColor = '#161b22';
	
	// Set date range to show last year
	const endDate = new Date();
	const startDate = new Date();
	startDate.setFullYear(startDate.getFullYear() - 1);
	
	grid.endDate = endDate.toISOString().split('T')[0];
	grid.startDate = startDate.toISOString().split('T')[0];
}

function updateSummary() {
	const summaryBox = document.getElementById('conversion-summary');
	if (!summaryBox || !sttData || !uhabitsData) return;

	const mappingItems = document.querySelectorAll('.mapping-item');

	let validMappings = 0;
	let totalNewDays = 0;
	const mappingDetails: string[] = [];

	for (let i = 0; i < mappingItems.length; i++) {
		const item = mappingItems[i];
		const sttSelect = item.querySelector('.stt-activity-select') as HTMLSelectElement;
		const uhabitsSelect = item.querySelector('.uhabits-habit-select') as HTMLSelectElement;
		const minDurationInput = item.querySelector('.min-duration-input') as HTMLInputElement;

		const sttTypeId = parseInt(sttSelect.value);
		const uhabitsHabitId = parseInt(uhabitsSelect.value);

		if (sttTypeId && uhabitsHabitId) {
			validMappings++;

			const sttType = sttData!.recordTypes.get(sttTypeId);
			const uhabit = uhabitsData!.habits.get(uhabitsHabitId);

			if (sttType && uhabit) {
				// Get min duration for this specific mapping
				const minDuration = minDurationInput ? parseInt(minDurationInput.value) || 0 : 0;
				// Calculate new days for this mapping
				const filteredRecords = filterRecordsByDuration(sttData!.records, minDuration);
				const typeRecords = getRecordsForType(filteredRecords, sttTypeId);
				const dayGroups = groupRecordsByDay(typeRecords);

				// Count only days that don't already exist
				const existingDates = new Set<string>();
				for (const rep of uhabitsData!.repetitions) {
					if (rep.habit_id === uhabitsHabitId && rep.value > 0) {
						existingDates.add(new Date(rep.timestamp).toISOString().split('T')[0]);
					}
				}

				let newDays = 0;
				for (const dayStr of dayGroups.keys()) {
					if (!existingDates.has(dayStr)) newDays++;
				}

				totalNewDays += newDays;
				mappingDetails.push(`"${sttType.emoji} ${sttType.name}" → "${uhabit.name}": ${newDays} new days`);
			}
		}
	}

	if (validMappings > 0) {
		summaryBox.style.display = 'block';
		summaryBox.innerHTML = `
			<h4>Conversion Summary</h4>
			<ul>
				<li>${validMappings} mapping(s) configured</li>
				<li>${totalNewDays} new repetitions will be added</li>
				<li>Existing uHabits data will be preserved</li>
				${mappingDetails.map(d => `<li>${d}</li>`).join('')}
			</ul>
		`;
	} else {
		summaryBox.style.display = 'none';
	}
}

function updateConvertButton() {
	const convertBtn = document.getElementById('btn-convert-stt') as HTMLButtonElement;
	if (!convertBtn) return;

	const sttInput = document.getElementById('file-left') as HTMLInputElement;
	const uhabitsInput = document.getElementById('file-right') as HTMLInputElement;
	const hasMappings = document.querySelectorAll('.mapping-item').length > 0;

	const canConvert = sttData && uhabitsData && 
		sttInput?.files?.[0] && uhabitsInput?.files?.[0] && hasMappings;

	convertBtn.disabled = !canConvert;
}

async function performSttConversion(SQL: SqlJsStatic) {
	if (!sttData || !uhabitsData) return;

	const sttInput = document.getElementById('file-left') as HTMLInputElement;
	const uhabitsInput = document.getElementById('file-right') as HTMLInputElement;
	const sttFile = sttInput?.files?.[0];
	const uhabitsFile = uhabitsInput?.files?.[0];

	if (!sttFile || !uhabitsFile) {
		log('Missing required files', 'err');
		return;
	}

	// Gather mappings from UI with per-mapping min duration
	const mappings: ConversionMapping[] = [];
	const mappingItems = document.querySelectorAll('.mapping-item');

	for (let i = 0; i < mappingItems.length; i++) {
		const item = mappingItems[i];
		const sttSelect = item.querySelector('.stt-activity-select') as HTMLSelectElement;
		const uhabitsSelect = item.querySelector('.uhabits-habit-select') as HTMLSelectElement;
		const minDurationInput = item.querySelector('.min-duration-input') as HTMLInputElement;

		const sttTypeId = parseInt(sttSelect.value);
		const uhabitsHabitId = parseInt(uhabitsSelect.value);
		const minDuration = minDurationInput ? parseInt(minDurationInput.value) || 0 : 0;

		if (sttTypeId && uhabitsHabitId) {
			mappings.push({ sttTypeId, uhabitsHabitId, minDuration });
		}
	}

	if (mappings.length === 0) {
		log('No valid mappings configured', 'err');
		return;
	}

	try {
		const convertBtn = document.getElementById('btn-convert-stt') as HTMLButtonElement;
		if (convertBtn) convertBtn.disabled = true;

		log('Starting conversion...', 'info');

		const blob = await convertSttToUHabits(
			sttFile,
			uhabitsFile,
			mappings,
			SQL
		);

		downloadFile(blob, 'uhabits_with_stt.backup', null);
		log('✓ Conversion complete! Download started.', 'info');
	} catch (error: any) {
		log(`Conversion failed: ${error.message}`, 'err');
		console.error(error);
	} finally {
		const convertBtn = document.getElementById('btn-convert-stt') as HTMLButtonElement;
		if (convertBtn) convertBtn.disabled = false;
	}
}
