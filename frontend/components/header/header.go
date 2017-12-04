package header

import (
	"honnef.co/go/js/dom"

	"github.com/cathalgarvey/fmtless"

	"github.com/gopherjs/vecty"
	"github.com/gopherjs/vecty/elem"
)

type View struct {
	vecty.Core
	num      int
	interval int
}

func (v *View) Render() vecty.ComponentOrHTML {
	str := fmt.Sprintf("Counter: %v", v.num)
	return elem.Heading1(
		vecty.Text(str),
	)
}

func (v *View) Mount() {
	interval := dom.GetWindow().SetInterval(func() {
		v.CB()
	}, 1000)

	v.interval = interval
}

func (v *View) Unmount() {
	dom.GetWindow().ClearInterval(v.interval)
}

func (v *View) CB() {
	v.num++
	vecty.Rerender(v)
}
