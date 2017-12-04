Experimental: hot module reloading for gopherjs and/or vecty.

This requires changes to the `gopherjs` compiler, so you need to checkout the `hmr` branch from [my fork](https://github.com/marwan-at-work/gopherjs) then run `go install`.

Run `main.go` and go to `localhost:9090`. Try changing the `header.go` file and see the changes reflected on the page. 

Keep in mind, this is an experiment to make something work, no best practices or architecture was put into this yet. 