package main

import (
	"github.com/marwan-at-work/hmr/frontend/runtime/hot"

	"github.com/cathalgarvey/fmtless/encoding/json"
	"github.com/gopherjs/gopherjs/js"
	"github.com/gopherjs/websocket/websocketjs"
)

const (
	eval    = "eval"
	hmrpkgs = "_$packages"
)

// Message splits the data into message name and data.
type Message struct {
	Data string `json:"data"`
	Name string `json:"name"`
}

func main() {
	// try relative URL
	ws, err := websocketjs.New("ws://localhost:9090/ws")
	if err != nil {
		panic(err)
	}

	js.Global.Set("hmrTrue", true)

	ws.AddEventListener("message", false, func(ev *js.Object) {
		bts := ev.Get("data").String()
		var msg Message
		if err := json.Unmarshal([]byte(bts), &msg); err != nil {
			panic(err)
		}

		// sanity check
		if msg.Name == "" {
			panic("empty message name")
		}

		if msg.Name == "init" {
			pkgs := js.Global.Call(eval, msg.Data)
			js.Global.Set(hmrpkgs, pkgs)
			return
		}

		importPath := msg.Name
		pkgs := js.Global.Call(eval, msg.Data)
		obj := pkgs.Get(importPath)
		for _, k := range js.Keys(obj) {
			v := obj.Get(k)
			if v.Get("prototype") != js.Undefined {
				// might need Object.getOwnPropertyNames
				for _, pk := range append(js.Keys(v.Get("prototype")), "constructor") {
					if v.Get("ptr") != js.Undefined && v.Get("ptr").Get("prototype") != js.Undefined {
						js.Global.Get(hmrpkgs).Get(importPath).Get(k).Get("ptr").Get("prototype").Set(pk, v.Get("ptr").Get("prototype").Get(pk))
						js.Global.Get(hmrpkgs).Get(importPath).Get(k).Get("prototype").Set(pk, v.Get("prototype").Get(pk))
					} else {
						js.Global.Get(hmrpkgs).Get(importPath).Get(k).Get("prototype").Set(pk, v.Get("prototype").Get(pk))
					}
				}

				continue
			}
			// js.Global.Get(hmrpkgs).Get(importPath).Set(k, v)
		}
		// js.Global.Get(hmrpkgs).Set(importPath, pkgs.Get(importPath))
		hot.Publish(importPath)
	})
}
