import type {StyleSheetLike, Keys} from "core/dom"
import {div} from "core/dom"
import type {ViewStorage, IterViews} from "core/build_views"
import {build_views, remove_views} from "core/build_views"
import type * as p from "core/properties"
import {UIElement, UIElementView} from "../ui/ui_element"
import type {Orientation} from "core/enums"
import {LogoStyle, Location} from "core/enums"
import {every, sort_by, includes, intersection, clear} from "core/util/array"
import {join} from "core/util/iterator"
import {typed_keys, values, entries} from "core/util/object"
import {isArray} from "core/util/types"
import type {EventRole} from "./tool"
import {Tool} from "./tool"
import type {ToolLike} from "./tool_proxy"
import {ToolProxy} from "./tool_proxy"
import {Divider, DividerView} from "./divider"
import {Logo} from "./logo"
import {GestureTool} from "./gestures/gesture_tool"
import {InspectTool} from "./inspectors/inspect_tool"
import {ActionTool} from "./actions/action_tool"
import {HelpTool} from "./actions/help_tool"
import {ContextMenu} from "core/util/menus"
import {ToolButton} from "./tool_button"
import {LayoutDOMView} from "../layouts/layout_dom"

import toolbars_css, * as toolbars from "styles/toolbar.css"
import icons_css from "styles/icons.css"

export class ToolbarView extends UIElementView {
  declare model: Toolbar

  get orientation(): Orientation {
    switch (this.model.location) {
      case "above":
      case "below":
        return "horizontal"
      case "left":
      case "right":
        return "vertical"
    }
  }

  get horizontal(): boolean {
    return this.orientation == "horizontal"
  }

  protected readonly _ui_element_views: ViewStorage<UIElement> = new Map()
  protected _ui_elements: UIElement[]
  protected _items: HTMLElement[] = []

  get ui_elements(): UIElement[] {
    return this._ui_elements
  }

  get ui_element_views(): UIElementView[] {
    return this._ui_elements.map((ui_element) => this._ui_element_views.get(ui_element)!)
  }

  protected _overflow_menu: ContextMenu
  protected _overflow_el: HTMLElement

  get overflow_el(): HTMLElement {
    return this._overflow_el
  }

  private _visible: boolean | null = null
  get visible(): boolean {
    return !this.model.visible ? false : (!this.model.autohide || (this._visible ?? false))
  }

  override *children(): IterViews {
    yield* super.children()
    yield* this._ui_element_views.values()
  }

  override has_finished(): boolean {
    if (!super.has_finished())
      return false

    for (const child_view of this._ui_element_views.values()) {
      if (!child_view.has_finished())
        return false
    }

    return true
  }

  override initialize(): void {
    super.initialize()

    const {location} = this.model
    const reversed = location == "left" || location == "above"
    const orientation = this.horizontal ? "vertical" : "horizontal"
    this._overflow_menu = new ContextMenu([], {
      target: this.root.el,
      orientation,
      reversed,
      prevent_hide: (event) => {
        return event.composedPath().includes(this._overflow_el)
      },
    })
  }

  override async lazy_initialize(): Promise<void> {
    await super.lazy_initialize()
    await this._build_tool_button_views()
  }

  override connect_signals(): void {
    super.connect_signals()

    const {children, tools} = this.model.properties
    this.on_change([children, tools], async () => {
      await this._build_tool_button_views()
      this.render()
    })

    this.connect(this.model.properties.autohide.change, () => {
      this._on_visible_change()
    })
  }

  override stylesheets(): StyleSheetLike[] {
    return [...super.stylesheets(), toolbars_css, icons_css]
  }

  override remove(): void {
    remove_views(this._ui_element_views)
    super.remove()
  }

  protected async _build_tool_button_views(): Promise<void> {
    const ui_elements = (() => {
      const {children} = this.model
      if (children == "auto") {
        const groups = [
          ...values(this.model.gestures).map((gesture) => gesture.tools),
          this.model.actions,
          this.model.inspectors.filter((tool) => tool.toggleable),
          this.model.auxiliaries,
        ]

        const button_groups = groups
          .filter((group) => group.length != 0)
          .map((group) => group.map((tool) => tool.tool_button()))

        return [...join(button_groups, () => new Divider())].flat()
      } else {
        return children.map((child) => child ?? new Divider())
      }
    })()

    const {logo} = this.model
    if (logo != null) {
      ui_elements.unshift(new Logo({style: logo}))
    }

    this._ui_elements = ui_elements
    await build_views(this._ui_element_views, this._ui_elements, {parent: this})
  }

  set_visibility(visible: boolean): void {
    if (visible != this._visible) {
      this._visible = visible
      this._on_visible_change()
    }
  }

  protected _on_visible_change(): void {
    this.el.classList.toggle(toolbars.hidden, !this.visible)
  }

  override _after_resize(): void {
    super._after_resize()
    this._after_render()
  }

  override render(): void {
    super.render()

    this.el.classList.add(toolbars[this.model.location])
    this.el.classList.toggle(toolbars.inner, this.model.inner)
    this._on_visible_change()

    this._overflow_el = div({class: toolbars.tool_overflow, tabIndex: 0}, this.horizontal ? "⋮" : "⋯")
    const toggle_menu = () => {
      const at = (() => {
        switch (this.model.location) {
          case "right": return {left_of:  this._overflow_el}
          case "left":  return {right_of: this._overflow_el}
          case "above": return {below: this._overflow_el}
          case "below": return {above: this._overflow_el}
        }
      })()
      this._overflow_menu.toggle(at)
    }
    this._overflow_el.addEventListener("click", () => {
      toggle_menu()
    })
    this._overflow_el.addEventListener("keydown", (event) => {
      if (event.key as Keys == "Enter") {
        toggle_menu()
      }
    })

    this._items = []

    let prev_divider = false
    for (const ui_view of this.ui_element_views) {
      if (ui_view instanceof DividerView) {
        if (prev_divider) {
          continue
        }
        prev_divider = true
      } else {
        prev_divider = false
      }

      ui_view.render_to(this.shadow_el)
      this._items.push(ui_view.el)

      if (ui_view instanceof LayoutDOMView) {
        ui_view.style.append(":host", {
          flex: "0 0 auto",
          align_self: "center",
          width: "auto",
          margin: "0 5px",
        })
      }
    }
  }

  override _after_render(): void {
    super._after_render()
    return // TMP

    clear(this._overflow_menu.items)

    if (this.shadow_el.contains(this._overflow_el)) {
      this.shadow_el.removeChild(this._overflow_el)
    }

    for (const el of this._items) {
      if (!this.shadow_el.contains(el)) {
        this.shadow_el.append(el)
      }
    }

    const {horizontal} = this
    const overflow_size = 15
    const {bbox} = this
    const overflow_cls = horizontal ? toolbars.right : toolbars.above
    let size = 0
    let overflowed = false

    for (const el of this._items) {
      if (overflowed) {
        this.shadow_el.removeChild(el)
        this._overflow_menu.items.push({custom: el, class: overflow_cls})
      } else {
        const {width, height} = el.getBoundingClientRect()
        size += horizontal ? width : height
        overflowed = horizontal ? size > bbox.width - overflow_size : size > bbox.height - overflow_size
        if (overflowed) {
          this.shadow_el.removeChild(el)
          this.shadow_el.appendChild(this._overflow_el)
          this._overflow_menu.items.push({custom: el, class: overflow_cls})
        }
      }
    }
  }
}

import {Struct, Ref, Nullable, Array, Or} from "../../core/kinds"

const GestureToolLike = Or(Ref(GestureTool), Ref(ToolProxy<GestureTool>))
const GestureEntry = Struct({
  tools: Array(GestureToolLike),
  active: Nullable(GestureToolLike),
})
const GesturesMap = Struct({
  pan:       GestureEntry,
  scroll:    GestureEntry,
  pinch:     GestureEntry,
  rotate:    GestureEntry,
  move:      GestureEntry,
  tap:       GestureEntry,
  doubletap: GestureEntry,
  press:     GestureEntry,
  pressup:   GestureEntry,
  multi:     GestureEntry,
})

type GesturesMap = typeof GesturesMap["__type__"]
type GestureType = keyof GesturesMap

// XXX: add appropriate base classes to get rid of this
export type Drag = Tool
export const Drag = Tool
export type Inspection = Tool
export const Inspection = Tool
export type Scroll = Tool
export const Scroll = Tool
export type Tap = Tool
export const Tap = Tool

type ActiveGestureToolsProps = {
  active_drag: p.Property<ToolLike<Drag> | "auto" | null>
  active_scroll: p.Property<ToolLike<Scroll> | "auto" | null>
  active_tap: p.Property<ToolLike<Tap> | "auto" | null>
  active_multi: p.Property<ToolLike<GestureTool> | "auto" | null>
}

export namespace Toolbar {
  export type Attrs = p.AttrsOf<Props>

  export type Props = UIElement.Props & {
    tools: p.Property<(Tool | ToolProxy<Tool>)[]>
    logo: p.Property<LogoStyle | null>
    autohide: p.Property<boolean>

    children: p.Property<(UIElement | null)[] | "auto">

    // internal
    location: p.Property<Location>
    inner: p.Property<boolean>

    gestures: p.Property<GesturesMap>
    actions: p.Property<ToolLike<ActionTool>[]>
    inspectors: p.Property<ToolLike<InspectTool>[]>
    help: p.Property<ToolLike<HelpTool>[]>
    auxiliaries: p.Property<ToolLike<Tool>[]>
  } & ActiveGestureToolsProps & {
    active_inspect: p.Property<ToolLike<Inspection> | ToolLike<Inspection>[] | "auto" | null>
  }
}

export interface Toolbar extends Toolbar.Attrs {}

function create_gesture_map(): GesturesMap {
  return {
    pan:       {tools: [], active: null},
    scroll:    {tools: [], active: null},
    pinch:     {tools: [], active: null},
    rotate:    {tools: [], active: null},
    move:      {tools: [], active: null},
    tap:       {tools: [], active: null},
    doubletap: {tools: [], active: null},
    press:     {tools: [], active: null},
    pressup:   {tools: [], active: null},
    multi:     {tools: [], active: null},
  }
}

export class Toolbar extends UIElement {
  declare properties: Toolbar.Props
  declare __view_type__: ToolbarView

  constructor(attrs?: Partial<Toolbar.Attrs>) {
    super(attrs)
  }

  static {
    this.prototype.default_view = ToolbarView

    this.define<Toolbar.Props>(({Boolean, Array, Or, Ref, Null, Nullable, Auto}) => ({
      children:       [ Or(Array(Or(Ref(UIElement), Null)), Auto), "auto" ],
      tools:          [ Array(Or(Ref(Tool), Ref(ToolProxy))), [] ],
      logo:           [ Nullable(LogoStyle), "normal" ],
      autohide:       [ Boolean, false ],
      active_drag:    [ Nullable(Or(Ref(Drag), Auto)), "auto" ],
      active_inspect: [ Nullable(Or(Ref(Inspection), Array(Ref(Inspection)), Auto)), "auto" ],
      active_scroll:  [ Nullable(Or(Ref(Scroll), Auto)), "auto" ],
      active_tap:     [ Nullable(Or(Ref(Tap), Auto)), "auto" ],
      active_multi:   [ Nullable(Or(Ref(GestureTool), Auto)), "auto" ],
    }))

    this.internal<Toolbar.Props>(({Array, Boolean, Ref, Or}) => {
      return {
        location:    [ Location, "right" ],
        inner:       [ Boolean, false ],
        gestures:    [ GesturesMap, create_gesture_map ],
        actions:     [ Array(Or(Ref(ActionTool), Ref(ToolProxy))), [] ],
        inspectors:  [ Array(Or(Ref(InspectTool), Ref(ToolProxy))), [] ],
        auxiliaries: [ Array(Or(Ref(Tool), Ref(ToolProxy))), [] ],
        help:        [ Array(Or(Ref(HelpTool), Ref(ToolProxy))), [] ],
      }
    })
  }

  get computed_tools(): ToolLike[] {
    const tools = [...this.tools]
    for (const child of this.children) {
      if (child instanceof ToolButton) {
        tools.push(child.tool)
      }
    }
    return tools
  }

  override connect_signals(): void {
    super.connect_signals()

    const {tools, children, active_drag, active_inspect, active_scroll, active_tap, active_multi} = this.properties
    this.on_change([tools, children, active_drag, active_inspect, active_scroll, active_tap, active_multi], () => {
      this._init_tools()
      this._activate_tools()
    })
  }

  override initialize(): void {
    super.initialize()
    this._init_tools()
    this._activate_tools()
  }

  protected _init_tools(): void {
    type AbstractConstructor<T, Args extends any[] = any[]> = abstract new (...args: Args) => T

    const visited = new Set<ToolLike<Tool>>()
    function isa<A extends Tool>(tool: ToolLike<Tool>, type: AbstractConstructor<A>): tool is ToolLike<A> {
      const is = (tool instanceof ToolProxy ? tool.underlying : tool) instanceof type
      if (is) {
        visited.add(tool)
      }
      return is
    }

    const tools = this.computed_tools

    const new_inspectors = tools.filter(t => isa(t, InspectTool)) as ToolLike<InspectTool>[]
    this.inspectors = new_inspectors

    const new_help = tools.filter(t => isa(t, HelpTool)) as ToolLike<HelpTool>[]
    this.help = new_help

    const new_actions = tools.filter(t => isa(t, ActionTool)) as ToolLike<ActionTool>[]
    this.actions = new_actions

    const new_gestures = create_gesture_map()
    for (const tool of tools) {
      if (isa(tool, GestureTool)) {
        new_gestures[tool.event_role].tools.push(tool)
      }
    }

    for (const et of typed_keys(new_gestures)) {
      const gesture = this.gestures[et]
      gesture.tools = sort_by(new_gestures[et].tools, (tool) => tool.default_order)

      if (gesture.active != null && every(gesture.tools, (tool) => tool.id != gesture.active?.id)) {
        gesture.active = null
      }
    }

    const new_auxiliaries = tools.filter((tool) => !visited.has(tool))
    this.auxiliaries = new_auxiliaries
  }

  protected _activate_tools(): void {
    if (this.active_inspect == "auto") {
      // do nothing as all tools are active be default
    } else if (this.active_inspect == null) {
      for (const inspector of this.inspectors)
        inspector.active = false
    } else if (isArray(this.active_inspect)) {
      const active_inspect = intersection(this.active_inspect, this.inspectors)
      if (active_inspect.length != this.active_inspect.length) {
        this.active_inspect = active_inspect
      }
      for (const inspector of this.inspectors) {
        if (!includes(this.active_inspect, inspector))
          inspector.active = false
      }
    } else {
      let found = false
      for (const inspector of this.inspectors) {
        if (inspector != this.active_inspect)
          inspector.active = false
        else
          found = true
      }
      if (!found) {
        this.active_inspect = null
      }
    }

    const _activate_gesture = (tool: ToolLike<GestureTool>) => {
      if (tool.active) {
        // tool was activated by a proxy, but we need to finish configuration manually
        this._active_change(tool)
      } else
        tool.active = true
    }

    // Connecting signals has to be done before changing the active state of the tools.
    for (const gesture of values(this.gestures)) {
      for (const tool of gesture.tools) {
        // XXX: connect once
        this.connect(tool.properties.active.change, () => this._active_change(tool))
      }
    }

    function _get_active_attr(et: GestureType): keyof ActiveGestureToolsProps | null {
      switch (et) {
        case "tap":    return "active_tap"
        case "pan":    return "active_drag"
        case "pinch":
        case "scroll": return "active_scroll"
        case "multi":  return "active_multi"
        default:       return null
      }
    }

    function _supports_auto(et: string): boolean {
      return et == "tap" || et == "pan"
    }

    for (const [event_role, gesture] of entries(this.gestures)) {
      const et = event_role as EventRole
      const active_attr = _get_active_attr(et)
      if (active_attr != null) {
        const active_tool = this[active_attr]
        if (active_tool == "auto") {
          if (gesture.tools.length != 0 && _supports_auto(et)) {
            _activate_gesture(gesture.tools[0])
          }
        } else if (active_tool != null) {
          // TODO: allow to activate a proxy of tools with any child?
          if (includes(this.computed_tools, active_tool)) {
            _activate_gesture(active_tool as ToolLike<GestureTool>) // XXX: remove this cast
          } else {
            this[active_attr] = null
          }
        } else {
          this.gestures[et].active = null
          for (const tool of this.gestures[et].tools) {
            tool.active = false
          }
        }
      }
    }
  }

  _active_change(tool: ToolLike<GestureTool>): void {
    const {event_types} = tool

    for (const et of event_types) {
      if (tool.active) {
        const currently_active_tool = this.gestures[et].active
        if (currently_active_tool != null && tool != currently_active_tool) {
          currently_active_tool.active = false
        }
        this.gestures[et].active = tool
      } else {
        this.gestures[et].active = null
      }
    }
  }
}
