package hot

import (
	"github.com/gopherjs/gopherjs/js"
)

// maps import paths to rerenders.
// var callbacks = map[string][]func(){}

const hmrCallbacks = "hmrCallbacks"

// type callbacks map[string][]func

func init() {
	// js: if window["hmrCallbacks"] === nil { window["hmrCallbacks"] = {} }
	if js.Global.Get(hmrCallbacks) == js.Undefined {
		js.Global.Set(hmrCallbacks, map[string][]func(){})
	}
}

// Subscribe adds a listener to the import path.
func Subscribe(importPath string, cb func()) {
	cbs := js.Global.Get(hmrCallbacks)
	if cbs.Get(importPath) == js.Undefined {
		cbs.Set(importPath, []string{})
	}

	length := cbs.Get(importPath).Length()
	cbs.Get(importPath).SetIndex(length, cb)
}

// Publish calls registered rerenders.
func Publish(importPath string) {
	cbs := js.Global.Get(hmrCallbacks)
	if cbs.Get(importPath) == js.Undefined {
		println("skipping " + importPath)
		return
	}

	length := cbs.Get(importPath).Length()
	for i := 0; i < length; i++ {
		cbs.Get(importPath).Index(i).Invoke()
	}
}

// IsHot tells a component whether hot module reload is enabled.
func IsHot() bool {
	return js.Global.Get("hmrTrue") != nil
}
