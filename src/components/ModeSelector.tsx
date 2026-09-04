import { type Component } from 'solid-js';
import { ArrowLeftRight, ArrowRight, DatabaseBackup, RotateCcwClock, Play, TimerReset } from 'lucide-solid';

export type Mode = 'merge' | 'convert' | 'stt' | 'timejot';

interface Props {
	mode: () => Mode;
	setMode: (mode: Mode) => void;
}

interface AppNodeProps { icon: any; name: string; }
const AppNode: Component<AppNodeProps> = props => (
	<span class="app-node">
		<span class="app-icon">{props.icon}</span>
		<span>{props.name}</span>
	</span>
);

export const ModeSelector: Component<Props> = (props) => {
	const select = (mode: Mode) => props.setMode(mode);
	const isVideo = () => props.mode() === 'merge' || props.mode() === 'convert';

	return (
		<section class="conversion-picker" aria-label="Supported conversions">
			<div class="route-grid">
				<article class="route-card video-route" classList={{ selected: isVideo() }}>
					<button
						class="route-main"
						type="button"
						onClick={() => select(props.mode() === "convert" ? "convert" : "merge")}
						aria-pressed={isVideo()}
					>
						<span class="route-status">Both</span>
						<span class="route-apps">
							<AppNode icon={<Play size={18} />} name="NewPipe" />
							<span class="route-arrow">
								<ArrowLeftRight size={20} />
							</span>
							<AppNode icon={<DatabaseBackup size={18} />} name="LibreTube" />
						</span>
						<span class="route-status-balancer"></span>
					</button>
					<div
						class="route-actions"
						role="group"
						aria-label="NewPipe and LibreTube operation"
					>
						<button
							type="button"
							classList={{ active: props.mode() === "merge" }}
							onClick={() => select("merge")}
						>
							Merge histories
						</button>
						<button
							type="button"
							classList={{ active: props.mode() === "convert" }}
							onClick={() => select("convert")}
						>
							Convert one backup
						</button>
					</div>
				</article>

				<button
					class="route-card route-main"
					classList={{ selected: props.mode() === "stt" }}
					type="button"
					onClick={() => select("stt")}
					aria-pressed={props.mode() === "stt"}
				>
					<span class="route-status">First</span>
					<span class="route-apps">
						<AppNode icon={<TimerReset size={18} />} name="Simple Time Tracker" />
						<span class="route-arrow">
							<ArrowRight size={20} />
						</span>
						<AppNode icon={<RotateCcwClock size={18} />} name="Loop Habits" />
					</span>
					<span class="route-status-balancer"></span>
				</button>

				<button
					class="route-card route-main"
					classList={{ selected: props.mode() === "timejot" }}
					type="button"
					onClick={() => select("timejot")}
					aria-pressed={props.mode() === "timejot"}
				>
					<span class="route-status">Second</span>
					<span class="route-apps">
						<AppNode icon={<TimerReset size={18} />} name="TimeJot" />
						<span class="route-arrow">
							<ArrowRight size={20} />
						</span>
						<AppNode icon={<RotateCcwClock size={18} />} name="Loop Habits" />
					</span>
					<span class="route-status-balancer"></span>
				</button>
			</div>
		</section>
	);
};
