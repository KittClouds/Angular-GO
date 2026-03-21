//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"syscall/js"

	"github.com/kittclouds/gokitt/internal/store"
	chatpkg "github.com/kittclouds/gokitt/pkg/chat"
)

func jsChatStartRun(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 3 {
		return ErrorResult("missing arguments: threadID, prompt, optionsJSON")
	}

	var options store.RunOptions
	if raw := args[2].String(); raw != "" && raw != "null" {
		if err := json.Unmarshal([]byte(raw), &options); err != nil {
			return ErrorResult("invalid options: " + err.Error())
		}
	}

	run, err := chatSvc.StartRun(context.Background(), args[0].String(), args[1].String(), options)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(run)
	return string(jsonBytes)
}

func jsChatPollRun(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments: runID")
	}

	snapshot, err := chatSvc.PollRun(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(snapshot)
	return string(jsonBytes)
}

func jsChatSubmitToolResults(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("missing arguments: runID, resultsJSON")
	}

	var results []chatpkg.SubmittedToolResult
	if raw := args[1].String(); raw != "" && raw != "null" {
		if err := json.Unmarshal([]byte(raw), &results); err != nil {
			return ErrorResult("invalid results: " + err.Error())
		}
	}

	snapshot, err := chatSvc.SubmitToolResults(args[0].String(), results)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(snapshot)
	return string(jsonBytes)
}

func jsChatSubmitApproval(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 3 {
		return ErrorResult("missing arguments: runID, approvalID, approved")
	}

	decisionJSON := ""
	if len(args) > 3 && !args[3].IsUndefined() && !args[3].IsNull() {
		decisionJSON = args[3].String()
	}

	snapshot, err := chatSvc.SubmitApproval(args[0].String(), args[1].String(), args[2].Bool(), decisionJSON)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(snapshot)
	return string(jsonBytes)
}

func jsChatCancelRun(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments: runID")
	}
	if err := chatSvc.CancelRun(args[0].String()); err != nil {
		return ErrorResult(err.Error())
	}
	return SuccessResult("Run cancelled")
}

func jsChatResumeRun(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments: runID")
	}

	run, err := chatSvc.ResumeRun(context.Background(), args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(run)
	return string(jsonBytes)
}

func jsChatListRunEvents(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments: threadID")
	}

	limit := 100
	if len(args) > 1 {
		limit = args[1].Int()
	}
	events, err := chatSvc.ListRunEvents(args[0].String(), limit)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(events)
	return string(jsonBytes)
}

func jsChatMarkRunStreaming(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("missing arguments: runID, assistantMessageID")
	}

	snapshot, err := chatSvc.MarkRunStreaming(args[0].String(), args[1].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(snapshot)
	return string(jsonBytes)
}

func jsChatCompleteRun(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 3 {
		return ErrorResult("missing arguments: runID, assistantMessageID, finalResponse")
	}

	finalErr := ""
	if len(args) > 3 && !args[3].IsUndefined() && !args[3].IsNull() {
		finalErr = args[3].String()
	}

	snapshot, err := chatSvc.CompleteRun(args[0].String(), args[1].String(), args[2].String(), finalErr)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(snapshot)
	return string(jsonBytes)
}
