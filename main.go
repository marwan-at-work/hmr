package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/fatih/color"
	"github.com/fsnotify/fsnotify"

	"github.com/nu7hatch/gouuid"

	"github.com/marwan-at-work/sourcemapper"

	"github.com/gorilla/websocket"
)

var tmplt *template.Template

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func parseTemplate() {
	bts, err := ioutil.ReadFile("./frontend/template/main.go.template")
	if err != nil {
		panic(err)
	}
	tmpl, err := template.New("main").Parse(string(bts))
	if err != nil {
		panic(err)
	}

	tmplt = tmpl
}

func main() {
	parseTemplate()
	http.HandleFunc("/", home)
	http.HandleFunc("/runtime.js", runtime)
	http.HandleFunc("/runtime.js.map", runtimeMap)
	http.HandleFunc("/frontend.js.map", runtimeMap)
	http.HandleFunc("/ws", ws)

	go worker("./frontend/components")
	log.Fatal(http.ListenAndServe(":9090", sourcemapper.NewHandler(nil)))
}

func home(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./index.html")
}

func runtime(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./frontend/runtime/runtime.js")
}

func runtimeMap(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./frontend/runtime/runtime.js.map")
}

func frontendMap(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./frontend/frontend.js.map")
}

// Message splits the data into message name and data.
type Message struct {
	Data string `json:"data"`
	Name string `json:"name"`
}

func ws(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	unsub, ch := sub()
	defer unsub()

	bts, err := getEntrypoint()
	if err != nil {
		panic(err)
	}

	msg := &Message{bts, "init"}
	d, err := json.Marshal(msg)
	if err != nil {
		panic(err)
	}

	err = conn.WriteMessage(websocket.TextMessage, d)
	if err != nil {
		panic(err)
	}

	for {
		msg := <-ch
		d, err := json.Marshal(msg)
		if err != nil {
			panic(err)
		}
		err = conn.WriteMessage(websocket.TextMessage, d)
		if err != nil {
			fmt.Println("could not write message", err)
			return
		}
	}
}

func getEntrypoint() (string, error) {
	cmd := exec.Command("gopherjs", "build")
	cmd.Dir = "./frontend"
	_, err := cmd.Output()
	if err != nil {
		return "", err
	}

	bts, err := ioutil.ReadFile("./frontend/frontend.js")
	return string(bts), err
}

var subs = map[string]chan *Message{}

func sub() (func(), chan *Message) {
	ch := make(chan *Message)

	id, err := uuid.NewV4()
	if err != nil {
		panic(err)
	}
	idS := id.String()
	subs[idS] = ch

	unsub := func() {
		for id := range subs {
			if id == idS {
				delete(subs, id)
			}
		}
	}

	return unsub, ch
}

func pub(m *Message) {
	for _, ch := range subs {
		go func(ch chan *Message) { ch <- m }(ch)
	}

}

func worker(dirPath string) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		panic(err)
	}
	defer w.Close()

	watch(dirPath, w)

	go func() {
		for e := range w.Events {
			if e.Op&fsnotify.Write == fsnotify.Write {
				log.Println(color.MagentaString("modified file: %v", e.Name))
				importPath, _ := filepath.Split(e.Name)
				// TODO dynamically figure out import path prefix.
				importPath = filepath.Join("github.com/marwan-at-work/hmr", importPath)
				// TODO package name might be different from dir name
				_, pkgName := filepath.Split(importPath)
				jsFile := doit(importPath, pkgName)
				pub(&Message{jsFile, importPath})
			}
		}
	}()

	// TODO get close signal from caller.
	<-make(chan struct{})
}

func watch(dirPath string, w *fsnotify.Watcher) {
	for _, f := range getFiles(dirPath) {
		if err := w.Add(f); err != nil {
			panic(err)
		}
	}
}

func getFiles(path string) []string {
	results := []string{}
	folder, err := os.Open(path)
	if err != nil {
		log.Fatalf("could not open watch dir: %v", err)
	}
	defer folder.Close()

	files, _ := folder.Readdir(-1)
	for _, file := range files {
		fileName := file.Name()
		newPath := filepath.Join(path, fileName)

		isValidDir := file.IsDir() && !strings.HasPrefix(fileName, ".") && fileName != "vendor"

		isValidFile := !file.IsDir() &&
			strings.HasSuffix(fileName, ".go") &&
			!strings.HasSuffix(fileName, "_test.go")

		if isValidDir {
			results = append(results, getFiles(newPath)...)
		} else if isValidFile {
			results = append(results, newPath)
		}
	}

	return results
}

type data struct {
	ImportPath, PackageName string
}

func doit(importPath, pkgName string) string {
	f, err := os.Create("./frontend/template/main.go")
	if err != nil {
		panic(err)
	}
	defer f.Close()
	err = tmplt.Execute(f, data{importPath, pkgName})
	if err != nil {
		panic(err)
	}

	cmd := exec.Command("gopherjs", "build")
	cmd.Dir = "./frontend/template"
	_, err = cmd.Output()
	if err != nil {
		panic(err)
	}

	bts, err := ioutil.ReadFile("./frontend/template/template.js")
	if err != nil {
		panic(err)
	}

	return string(bts)
}
