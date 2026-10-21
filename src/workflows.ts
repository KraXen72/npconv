/** Supported backup workflows and their contextual actions. */
export const WORKFLOWS = [
  {
    value: 'video',
    label: 'Video backups',
    contextLabel: 'NewPipe ⇄ LibreTube',
    selectId: 'video-action',
    modes: [
      { value: 'merge', label: 'Merge backups' },
      { value: 'convert', label: 'Convert backup' },
    ],
  },
  {
    value: 'import',
    label: 'Import habit data',
    contextLabel: 'Import from',
    selectId: 'habit-source',
    modes: [
      { value: 'stt', label: 'SimpleTimeTracker' },
      { value: 'timejot', label: 'TimeJot' },
    ],
  },
  {
    value: 'edit',
    label: 'Edit uHabits',
    contextLabel: '',
    selectId: '',
    modes: [{ value: 'uhabits', label: 'Edit uHabits' }],
  },
] as const;

type Workflow = (typeof WORKFLOWS)[number];
export type Mode = Workflow['modes'][number]['value'];

/** Find the workflow that owns a supported mode. */
export function getWorkflow(mode: Mode): Workflow {
  const workflow = WORKFLOWS.find((option) => option.modes.some((action) => action.value === mode));
  if (!workflow) throw new Error(`Unsupported backup mode: ${mode}`);
  return workflow;
}

/** Video actions share files; each habit import source requires its own uploads. */
export function getFileGroup(mode: Mode): string {
  const workflow = getWorkflow(mode);
  return workflow.value === 'video' ? workflow.value : mode;
}
