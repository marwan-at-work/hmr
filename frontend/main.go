package main

import (
	"github.com/marwan-at-work/hmr/frontend/components/body"
	"github.com/marwan-at-work/hmr/frontend/runtime/hot"

	"github.com/gopherjs/vecty"
)

func main() {
	b := &body.View{}
	vecty.RenderBody(b)

	if hot.IsHot() {
		// TODO: Either accept by folder, or parse the package to accept its dependencies as well.
		hot.Subscribe("github.com/marwan-at-work/hmr/frontend/components/header", rerender(b))
	}
}

func rerender(b *body.View) func() {
	return func() {
		vecty.Rerender(b)
	}
}
