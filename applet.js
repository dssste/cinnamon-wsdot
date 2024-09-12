const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Applet = imports.ui.applet;
const AppletManager = imports.ui.appletManager;
const Main = imports.ui.main;
const SignalManager = imports.misc.signalManager;

const MAX_TEXT_LENGTH = 1000;

class WindowHandler {
	constructor(applet, metaWindow) {
		this._applet = applet;
		this.metaWindow = metaWindow;

		this.onFocus();

		this._signals = new SignalManager.SignalManager();
		this._signals.connect(this.metaWindow, 'notify::title', this.onFocus, this);
		this._signals.connect(this.metaWindow, "notify::appears-focused", this.onFocus, this);
		this._signals.connect(this.metaWindow, "unmanaged", this.onUnmanaged, this);
	}

	onUnmanaged() {
		this.destroy();
		this._applet._windows.splice(this._windows.indexOf(this), 1);
	}

	destroy() {
		this._signals.disconnectAllSignals();
	}

	_hasFocus() {
		if (!this.metaWindow || this.metaWindow.minimized)
			return false;
		if (this.metaWindow.has_focus())
			return true;
		if (global.display.focus_window && this.metaWindow.is_ancestor_of_transient(global.display.focus_window))
			return true;
		return false
	}

	onFocus() {
		if(this._hasFocus()){
			let title = this.metaWindow.get_title();
			let tracker = Cinnamon.WindowTracker.get_default();
			let app = tracker.get_window_app(this.metaWindow);

			if (!title) title = app ? app.get_name() : '?';

			title = title.replace(/\s/g, " ");
			if (title.length > MAX_TEXT_LENGTH)
				title = title.substr(0, MAX_TEXT_LENGTH);

			this._applet.set_applet_label(title);
		}
	}
};

class FocusdWindowTitle extends Applet.TextApplet {
	constructor(orientation, panel_height, instance_id) {
		super(orientation, panel_height, instance_id);

		this.actor.set_track_hover(false);
		this.appletEnabled = false;

		this._windows = [];
		this._monitorWatchList = [];

		this.signals = new SignalManager.SignalManager(null);
		this.signals.connect(global.display, 'window-created', this._onWindowAddedAsync, this);
		this.signals.connect(global.display, 'window-monitor-changed', this._onWindowMonitorChanged, this);
		this.signals.connect(global.display, 'window-skip-taskbar-changed', this._onWindowSkipTaskbarChanged, this);
		this.signals.connect(Main.panelManager, 'monitors-changed', this._updateWatchedMonitors, this);
	}

	on_applet_added_to_panel(userEnabled) {
		this.appletEnabled = true;
	}

	on_applet_removed_from_panel() {
		this.signals.disconnectAllSignals();
		for (let window of windows) {
			window.destroy();
		}
	}

	on_applet_instances_changed() {
		this._updateWatchedMonitors();
	}

	_onWindowAddedAsync(display, metaWindow, monitor) {
		Mainloop.timeout_add(20, Lang.bind(this, this._onWindowAdded, display, metaWindow, monitor));
	}

	_onWindowAdded(display, metaWindow, monitor) {
		if (this._shouldAdd(metaWindow))
			this._addWindow(metaWindow, false);
	}

	_onWindowMonitorChanged(display, metaWindow, monitor) {
		if (this._shouldAdd(metaWindow))
			this._addWindow(metaWindow, false);
		else {
			this.refreshing = true;
			this._removeWindow(metaWindow);
			this.refreshing = false;
		}
	}

	_onWindowSkipTaskbarChanged(display, metaWindow) {
		if (metaWindow && metaWindow.is_skip_taskbar()) {
			this._removeWindow(metaWindow);
			return;
		}

		this._onWindowAdded(display, metaWindow, 0);
	}

	_updateWatchedMonitors() {
		let n_mons = global.display.get_n_monitors();
		let on_primary = this.panel.monitorIndex == Main.layoutManager.primaryIndex;
		let instances = Main.AppletManager.getRunningInstancesForUuid(this._uuid);

		/* Simple cases */
		if (n_mons == 1) {
			this._monitorWatchList = [Main.layoutManager.primaryIndex];
		} else if (instances.length > 1 && !on_primary) {
			this._monitorWatchList = [this.panel.monitorIndex];
		} else {
			/* This is an instance on the primary monitor - it will be
			 * responsible for any monitors not covered individually.  First
			 * convert the instances list into a list of the monitor indices,
			 * and then add the monitors not present to the monitor watch list
			 * */
			this._monitorWatchList = [this.panel.monitorIndex];

			instances = instances.map(function(x) {
				return x.panel.monitorIndex;
			});

			for (let i = 0; i < n_mons; i++)
				if (instances.indexOf(i) == -1)
					this._monitorWatchList.push(i);
		}

		// Now track the windows in our favorite monitors
		let windows = global.display.list_windows(0);
		for (let wks=0; wks<global.workspace_manager.n_workspaces; wks++) {
			let metaWorkspace = global.workspace_manager.get_workspace_by_index(wks);
			let wks_windows = metaWorkspace.list_windows();
			for (let wks_window of wks_windows) {
				windows.push(wks_window);
			}
		}

		this.refreshing = true;

		for (let window of windows) {
			if (this._shouldAdd(window))
				this._addWindow(window, false);
			else
				this._removeWindow(window);
		}

		this.refreshing = false;
	}

	_addWindow(metaWindow, transient) {
		for (let window of this._windows)
			if (window.metaWindow == metaWindow &&
				window.transient == transient)
				return;

		let handler = new WindowHandler(this, metaWindow);
		this._windows.push(handler);
	}

	_removeWindow(metaWindow) {
		let i = this._windows.length;
		while (i--) {
			if (this._windows[i].metaWindow == metaWindow) {
				this._windows[i].destroy();
				this._windows.splice(i, 1);
			}
		}
	}

	_shouldAdd(metaWindow) {
		return Main.isInteresting(metaWindow) &&
			!metaWindow.is_skip_taskbar() &&
			this._monitorWatchList.indexOf(metaWindow.get_monitor()) != -1;
	}
}

function main(metadata, orientation, panel_height, instance_id) {
	return new FocusdWindowTitle(orientation, panel_height, instance_id);
}
