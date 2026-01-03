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
const gridYears = new Map<number, number>(); // mappingId -> current year

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
			document.querySelectorAll('.stt-activity-select').forEach(select => populateSttSelect(select as HTMLSelectElement));
			hideAllActivityGrids();
			updateSummary();
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
			log(`Loaded ${uhabitsData.allHabits.size} habits (${uhabitsData.booleanHabits.size} boolean)`, 'info');
			document.querySelectorAll('.uhabits-habit-select').forEach(select => populateUHabitsSelect(select as HTMLSelectElement));
			hideAllActivityGrids();
			updateSummary();
			updateConvertButton();
		} catch (error: any) {
			log(`Error loading uHabits file: ${error.message}`, 'err');		if (uhabitsData?.db) uhabitsData.db.close();			uhabitsData = null;
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
			<span class="mapping-arrow">▶</span>
			<select class="uhabits-habit-select" data-mapping-id="${mappingId}">
				<option value="">Select uHabits habit...</option>
			</select>
			<button class="remove-button remove-mapping" aria-label="Remove mapping">
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><!-- Icon from Lucide by Lucide Contributors - https://github.com/lucide-icons/lucide/blob/main/LICENSE --><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>
		<div class="mapping-options">
			<label class="option-item">
				<span class="option-label">Min duration:</span>
				<input type="number" class="min-duration-input" value="5" min="0" step="1" title="Minimum duration in minutes">
				<span class="option-unit">min</span>
			</label>
			<label class="option-item option-checkbox" title="Copy STT activity comments to repetition notes">
				<input type="checkbox" class="copy-stt-comments-checkbox">
				<span class="option-label">Copy comments</span>
			</label>
		</div>
		<div class="activity-grid-container" style="display: none;">
			<div class="grid-year-nav">
				<button class="year-prev" data-mapping-id="${mappingId}" title="Previous year">◀</button>
				<span class="grid-year-display"></span>
				<button class="year-next" data-mapping-id="${mappingId}" title="Next year">▶</button>
			</div>
			<activity-grid start-week-on-monday class="habit-preview-grid" dark-mode color-theme="purple"></activity-grid>
		</div>
	`;

	mappingList.appendChild(item);

	// Year will be initialized in updateActivityGrid when data is available

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
		gridYears.delete(mappingId);
		item.remove();
		updateSummary();
		updateConvertButton();
	});

	// Year navigation buttons
	const yearPrevBtn = item.querySelector('.year-prev') as HTMLButtonElement;
	const yearNextBtn = item.querySelector('.year-next') as HTMLButtonElement;
	
	if (yearPrevBtn) {
		yearPrevBtn.addEventListener('click', () => {
			const currentYear = gridYears.get(mappingId) || new Date().getFullYear();
			gridYears.set(mappingId, currentYear - 1);
			updateActivityGrid(mappingId);
		});
	}
	
	if (yearNextBtn) {
		yearNextBtn.addEventListener('click', () => {
			const currentYear = gridYears.get(mappingId) || new Date().getFullYear();
			gridYears.set(mappingId, currentYear + 1);
			updateActivityGrid(mappingId);
		});
	}
}

function populateSttSelect(select: HTMLSelectElement) {
	if (!sttData) return;

	// Clear existing options except first
	select.innerHTML = '<option value="">Select STT activity...</option>';
	select.value = ''; // Reset selection

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
	select.value = ''; // Reset selection

	// Separate active and archived habits (only boolean habits for UI)
	const activeHabits: [number, any][] = [];
	const archivedHabits: [number, any][] = [];

	for (const [id, habit] of uhabitsData.booleanHabits) {
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

function hideAllActivityGrids() {
	document.querySelectorAll('.activity-grid-container').forEach(container => {
		(container as HTMLElement).style.display = 'none';
	});
}

function calculateNewDaysForMapping(sttTypeId: number, uhabitsHabitId: number, minDuration: number): number {
	if (!sttData || !uhabitsData) return 0;
	
	const filteredRecords = filterRecordsByDuration(sttData.records, minDuration);
	const typeRecords = getRecordsForType(filteredRecords, sttTypeId);
	const dayGroups = groupRecordsByDay(typeRecords);

	const existingDates = new Set<string>();
	for (const rep of uhabitsData.repetitions) {
		if (rep.habit_id === uhabitsHabitId && rep.value > 0) {
			existingDates.add(new Date(rep.timestamp).toISOString().split('T')[0]);
		}
	}

	let newDays = 0;
	for (const dayStr of dayGroups.keys()) {
		if (!existingDates.has(dayStr)) newDays++;
	}
	return newDays;
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

	const minDurationInput = item.querySelector('.min-duration-input') as HTMLInputElement;
	const minDuration = minDurationInput ? parseInt(minDurationInput.value) || 0 : 0;

	// Get existing repetitions as dates
	const existingDates = new Set<string>();
	const existingData: any[] = [];
	
	for (const rep of uhabitsData.repetitions) {
		if (rep.habit_id === uhabitsHabitId && rep.value > 0) {
			const date = new Date(rep.timestamp).toISOString().split('T')[0];
			existingDates.add(date);
			existingData.push({ date, count: 2 });
		}
	}

	// Get new repetitions from STT
	const filteredRecords = filterRecordsByDuration(sttData.records, minDuration);
	const typeRecords = getRecordsForType(filteredRecords, sttTypeId);
	const dayGroups = groupRecordsByDay(typeRecords);

	const newData: any[] = [];
	for (const [dayStr] of dayGroups) {
		if (!existingDates.has(dayStr)) {
			newData.push({ date: dayStr, count: 1 });
		}
	}

	grid.data = [...existingData, ...newData];
	
	// Initialize year to last entry year if not set
	if (!gridYears.has(mappingId)) {
		const allDates = [...existingData.map(d => d.date), ...newData.map(d => d.date)];
		if (allDates.length > 0) {
			allDates.sort();
			const lastDate = allDates[allDates.length - 1];
			const lastYear = new Date(lastDate).getFullYear();
			gridYears.set(mappingId, lastYear);
		} else {
			gridYears.set(mappingId, new Date().getFullYear());
		}
	}
	
	// Get the current year for this grid
	const displayYear = gridYears.get(mappingId) || new Date().getFullYear();
	
	// Set date range to show the selected year
	const startDate = new Date(displayYear, 0, 1); // Jan 1st of the year
	const endDate = new Date(displayYear, 11, 31); // Dec 31st of the year
	
	grid.endDate = endDate.toISOString().split('T')[0];
	grid.startDate = startDate.toISOString().split('T')[0];
	
	// Update year display
	const yearDisplay = gridContainer.querySelector('.grid-year-display') as HTMLElement;
	if (yearDisplay) {
		yearDisplay.textContent = displayYear.toString();
	}
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
			const uhabit = uhabitsData!.booleanHabits.get(uhabitsHabitId);

			if (sttType && uhabit) {
				const minDuration = minDurationInput ? parseInt(minDurationInput.value) || 0 : 0;
				const newDays = calculateNewDaysForMapping(sttTypeId, uhabitsHabitId, minDuration);
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
				<li>${totalNewDays} new repetitions will be added</li>
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
		const copySttCommentsCheckbox = item.querySelector('.copy-stt-comments-checkbox') as HTMLInputElement;

		const sttTypeId = parseInt(sttSelect.value);
		const uhabitsHabitId = parseInt(uhabitsSelect.value);
		const minDuration = minDurationInput ? parseInt(minDurationInput.value) || 0 : 0;
		const copySttComments = copySttCommentsCheckbox ? copySttCommentsCheckbox.checked : false;

		if (sttTypeId && uhabitsHabitId) {
			mappings.push({ sttTypeId, uhabitsHabitId, minDuration, copySttComments });
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
		log('Conversion complete! Download started.', 'info');
	} catch (error: any) {
		log(`Conversion failed: ${error.message}`, 'err');
		console.error(error);
	} finally {
		const convertBtn = document.getElementById('btn-convert-stt') as HTMLButtonElement;
		if (convertBtn) convertBtn.disabled = false;
	}
}
