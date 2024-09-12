const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const SignalManager = imports.misc.signalManager;
const ModalDialog = imports.ui.modalDialog;
const Pango = imports.gi.Pango;

class WorkspaceButton {
	constructor(index, applet) {
		this.index = index;
		this.applet = applet;
		this.workspace = global.workspace_manager.get_workspace_by_index(this.index);
		this.workspace_name = Main.getWorkspaceName(index);

		this.ws_signals = new SignalManager.SignalManager(null);

		this.ws_signals.connect(this.workspace, "window-added", this.update, this);
		this.ws_signals.connect(this.workspace, "window-removed", this.update, this);

		this.actor = new St.Button({ name: 'workspaceButton',
			style_class: 'workspace-button',
			reactive: applet._draggable.inhibit });

		if (applet.orientation == St.Side.TOP || applet.orientation == St.Side.BOTTOM) {
			this.actor.set_height(applet._panelHeight);
		} else {
			this.actor.set_width(applet._panelHeight);
			this.actor.add_style_class_name('vertical');
		}

		let label = new St.Label({ text: "-" });
		this.actor.set_child(label);
		this.update();
	}

	show() {
		this.actor.connect('button-release-event', Lang.bind(this, this.onClicked));
		if (this.index === global.workspace_manager.get_active_workspace_index()) {
			this.activate(true);
		}
	}

	onClicked(actor, event) {
		if (event.get_button() == 1) {
			Main.wm.moveToWorkspace(this.workspace);
		}
	}

	update() {
		let windows = this.workspace.list_windows();
		let used = windows.some(Main.isInteresting);
		if (!used) {
			this.actor.add_style_pseudo_class('shaded');
		}
		else {
			this.actor.remove_style_pseudo_class('shaded');
		}
	}

	activate(active) {
		if (active) {
			this.actor.add_style_pseudo_class('outlined');
		}
		else {
			this.actor.remove_style_pseudo_class('outlined');
			this.update();
		}
	}

	destroy() {
		this.ws_signals.disconnectAllSignals();
		this.ctor.destroy();
	}
}

class CinnamonWorkspaceSwitcher extends Applet.Applet {
	constructor(metadata, orientation, panel_height, instance_id) {
		super(orientation, panel_height, instance_id);

		this.setAllowedLayout(Applet.AllowedLayout.BOTH);

		this.orientation = orientation;
		this.signals = new SignalManager.SignalManager(null);
		this.buttons = [];
		this._last_switch = 0;
		this._last_switch_direction = 0;
		this.createButtonsQueued = false;

		this._focusWindow = null;
		if (global.display.focus_window)
			this._focusWindow = global.display.focus_window;

		this.signals.connect(Main.layoutManager, 'monitors-changed', this.onWorkspacesUpdated, this);

		this.queueCreateButtons();
		global.workspace_manager.connect('notify::n-workspaces', () => { this.onWorkspacesUpdated() });
		global.workspace_manager.connect('workspaces-reordered', () => { this.onWorkspacesUpdated() });
		global.window_manager.connect('switch-workspace', this._onWorkspaceChanged.bind(this));
		global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed));

		let expoMenuItem = new PopupMenu.PopupIconMenuItem(_("Expo"), "view-grid-symbolic", St.IconType.SYMBOLIC);
		expoMenuItem.connect('activate', Lang.bind(this, function() {
			if (!Main.expo.animationInProgress)
				Main.expo.toggle();
		}));
		this._applet_context_menu.addMenuItem(expoMenuItem);
	}

	onWorkspacesUpdated() {
		this._createButtons();
	}

	_onWorkspaceChanged(wm, from, to) {
		this.buttons[from].activate(false);
		this.buttons[to].activate(true);
	}

	on_panel_edit_mode_changed() {
		let reactive = !global.settings.get_boolean('panel-edit-mode');
		for (let i = 0; i < this.buttons.length; ++i) {
			this.buttons[i].actor.reactive = reactive;
		}
	}

	on_orientation_changed(neworientation) {
		this.orientation = neworientation;

		if (this.orientation == St.Side.TOP || this.orientation == St.Side.BOTTOM)
			this.actor.set_vertical(false);
		else
			this.actor.set_vertical(true);

		this.queueCreateButtons();
	}

	on_panel_height_changed() {
		this.queueCreateButtons();
	}

	queueCreateButtons() {
		if (!this.createButtonsQueued) {
			Mainloop.idle_add(Lang.bind(this, this._createButtons));
			this.createButtonsQueued = true;
		}
	}

	_createButtons() {
		this.createButtonsQueued = false;
		for (let i = 0; i < this.buttons.length; ++i) {
			this.buttons[i].destroy();
		}

		this.actor.set_style_class_name('workspace-switcher');

		this.actor.set_important(true);

		this.buttons = [];
		for (let i = 0; i < global.workspace_manager.n_workspaces; ++i) {
			this.buttons[i] = new WorkspaceButton(i, this);

			this.actor.add_actor(this.buttons[i].actor);
			this.buttons[i].show();
		}

		this.signals.disconnect("notify::focus-window");
	}

	_onPositionChanged() {
		let button = this.buttons[global.workspace_manager.get_active_workspace_index()];
		button.update();
	}

	on_applet_removed_from_panel() {
		this.signals.disconnectAllSignals();
	}
}

function main(metadata, orientation, panel_height, instance_id) {
	return new CinnamonWorkspaceSwitcher(metadata, orientation, panel_height, instance_id);
}
