//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/kittclouds/gokitt/pkg/graptor"
)

var fullSystemManager *graptor.FullSystemManager

func ensureFullSystemManager() *graptor.FullSystemManager {
	if fullSystemManager == nil {
		fullSystemManager = graptor.NewFullSystemManager(sqlStore)
	} else {
		fullSystemManager.SetStore(sqlStore)
	}
	return fullSystemManager
}

func marshalSystemResult(v interface{}) interface{} {
	data, err := json.Marshal(v)
	if err != nil {
		return ErrorResult("json marshal: " + err.Error())
	}
	return string(data)
}

func systemCreateSession(this js.Value, args []js.Value) interface{} {
	manager := ensureFullSystemManager()

	var cfg *graptor.FullSystemConfig
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		var parsed graptor.FullSystemConfig
		if err := json.Unmarshal([]byte(args[0].String()), &parsed); err != nil {
			return ErrorResult("invalid full system config json: " + err.Error())
		}
		cfg = &parsed
	}

	sessionID, err := manager.CreateSession(cfg)
	if err != nil {
		return ErrorResult(err.Error())
	}

	return marshalSystemResult(map[string]string{"sessionId": sessionID})
}

func systemIngest(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("systemIngest requires 2 args: sessionID, requestJSON")
	}

	manager := ensureFullSystemManager()
	sessionID := args[0].String()

	var req graptor.IngestRequest
	if err := json.Unmarshal([]byte(args[1].String()), &req); err != nil {
		return ErrorResult("invalid ingest request json: " + err.Error())
	}

	result, err := manager.IngestDocuments(sessionID, req)
	if err != nil {
		return ErrorResult(err.Error())
	}
	return marshalSystemResult(result)
}

func systemSearch(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("systemSearch requires 2 args: sessionID, requestJSON")
	}

	manager := ensureFullSystemManager()
	sessionID := args[0].String()

	var req graptor.SearchRequest
	if err := json.Unmarshal([]byte(args[1].String()), &req); err != nil {
		return ErrorResult("invalid search request json: " + err.Error())
	}

	result, err := manager.Search(sessionID, req)
	if err != nil {
		return ErrorResult(err.Error())
	}
	return marshalSystemResult(result)
}

func systemCommit(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("systemCommit requires at least 1 arg: sessionID")
	}

	manager := ensureFullSystemManager()
	sessionID := args[0].String()

	var req graptor.CommitRequest
	if len(args) > 1 && args[1].String() != "" && args[1].String() != "null" {
		if err := json.Unmarshal([]byte(args[1].String()), &req); err != nil {
			return ErrorResult("invalid commit request json: " + err.Error())
		}
	}

	result, err := manager.Commit(sessionID, req)
	if err != nil {
		return ErrorResult(err.Error())
	}
	return marshalSystemResult(result)
}

func systemGetState(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("systemGetState requires 1 arg: sessionID")
	}

	manager := ensureFullSystemManager()
	result, err := manager.GetState(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}
	return marshalSystemResult(result)
}

func systemGetStats(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("systemGetStats requires 1 arg: sessionID")
	}

	manager := ensureFullSystemManager()
	result, err := manager.GetStats(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}
	return marshalSystemResult(result)
}

func systemClose(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("systemClose requires 1 arg: sessionID")
	}

	manager := ensureFullSystemManager()
	if err := manager.CloseSession(args[0].String()); err != nil {
		return ErrorResult(err.Error())
	}
	return SuccessResult("session closed")
}

func systemRun(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("systemRun requires 1 arg: requestJSON")
	}

	manager := ensureFullSystemManager()

	var req graptor.RunOnceRequest
	if err := json.Unmarshal([]byte(args[0].String()), &req); err != nil {
		return ErrorResult("invalid run request json: " + err.Error())
	}

	result, err := manager.RunOnce(req)
	if err != nil {
		return ErrorResult(err.Error())
	}
	return marshalSystemResult(result)
}
