const St = imports.gi.St;
const Lang = imports.lang;
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const SignalManager = imports.misc.signalManager;
const ModalDialog = imports.ui.modalDialog;

function removeWorkspaceAtIndex(index) {
	if (global.workspace_manager.n_workspaces <= 1 ||
		index >= global.workspace_manager.n_workspaces) {
		return;
	}

	const removeAction = () => {
		Main._removeWorkspace(global.workspace_manager.get_workspace_by_index(index));
	};

	if (!Main.hasDefaultWorkspaceName(index)) {
		let prompt = _("Are you sure you want to remove workspace \"%s\"?\n\n").format(
			Main.getWorkspaceName(index)
		);

		let confirm = new ModalDialog.ConfirmDialog(prompt, removeAction);
		confirm.open();
	}
	else {
		removeAction();
	}
}

class SimpleButton {
	constructor(index, applet) {
		this.index = index;
		this.applet = applet;
		this.workspace = global.workspace_manager.get_workspace_by_index(this.index);
		this.workspace_name = Main.getWorkspaceName(index);

		this.ws_signals = new SignalManager.SignalManager(null);

		this.ws_signals.connect(this.workspace, "window-added", this.update, this);
		this.ws_signals.connect(this.workspace, "window-removed", this.update, this);

		this.ws_signals.connect_after(Main.wmSettings, "changed::workspace-names", this.updateName, this);

		this.actor = new St.Button({ name: 'workspaceButton',
			style_class: 'workspace-button',
			reactive: applet._draggable.inhibit });

		if (applet.orientation == St.Side.TOP || applet.orientation == St.Side.BOTTOM) {
			this.actor.set_height(applet._panelHeight);
		} else {
			this.actor.set_width(applet._panelHeight);
			this.actor.add_style_class_name('vertical');
		}

		let label = new St.Label({ text: "•" });
		this.actor.set_child(label);
		this.update();
		this.actor.set_style('background: transparent; border: none;');
	}

	show() {
		this.actor.connect('button-release-event', Lang.bind(this, this.onClicked));
		if (this.index === global.workspace_manager.get_active_workspace_index()) {
			this.activate(true);
		}
	}

	updateName() {
		this.workspace_name = Main.getWorkspaceName(this.index);
	}

	onClicked(actor, event) {
		if (event.get_button() == 1) {
			Main.wm.moveToWorkspace(this.workspace);
		} else if (event.get_button() == 2) {
			removeWorkspaceAtIndex(this.index);
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
		this.actor.destroy();
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

		let addWorkspaceMenuItem = new PopupMenu.PopupIconMenuItem (_("Add a new workspace"), "list-add", St.IconType.SYMBOLIC);
		addWorkspaceMenuItem.connect('activate', Lang.bind(this, function() {
			Main._addWorkspace();
		}));
		this._applet_context_menu.addMenuItem(addWorkspaceMenuItem);

		this.removeWorkspaceMenuItem = new PopupMenu.PopupIconMenuItem (_("Remove the current workspace"), "list-remove", St.IconType.SYMBOLIC);
		this.removeWorkspaceMenuItem.connect('activate', this.removeCurrentWorkspace.bind(this));
		this._applet_context_menu.addMenuItem(this.removeWorkspaceMenuItem);
		this.removeWorkspaceMenuItem.setSensitive(global.workspace_manager.n_workspaces > 1);
	}

	onWorkspacesUpdated() {
		this.removeWorkspaceMenuItem.setSensitive(global.workspace_manager.n_workspaces > 1);
		this._createButtons();
	}

	removeCurrentWorkspace() {
		if (global.workspace_manager.n_workspaces <= 1) {
			return;
		}
		this.workspace_index = global.workspace_manager.get_active_workspace_index();
		removeWorkspaceAtIndex(this.workspace_index);
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
			this.buttons[i] = new SimpleButton(i, this);
			this.actor.add_actor(this.buttons[i].actor);
			this.buttons[i].show();
		}

		this.signals.disconnect("notify::focus-window");
	}

	on_applet_removed_from_panel() {
		this.signals.disconnectAllSignals();
	}
}

function main(metadata, orientation, panel_height, instance_id) {
	return new CinnamonWorkspaceSwitcher(metadata, orientation, panel_height, instance_id);
}
