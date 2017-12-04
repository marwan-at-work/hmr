package body

import (
	"github.com/marwan-at-work/hmr/frontend/components/header"

	"github.com/gopherjs/vecty"
	"github.com/gopherjs/vecty/elem"
)

// View component
type View struct {
	vecty.Core
}

// Render renders.
func (b *View) Render() vecty.ComponentOrHTML {
	return elem.Body(
		&header.View{},
	)
}
