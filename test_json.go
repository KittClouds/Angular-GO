
package main

import (
"encoding/json"
"fmt"
)

type Folder struct {
ID              string  `json:"id"`
Name            string  `json:"name"`
ParentID        string  `json:"parentId,omitempty"`
WorldID         string  `json:"worldId"`
NarrativeID     string  `json:"narrativeId,omitempty"`
FolderOrder     float64 `json:"folderOrder"`
EntityKind      string  `json:"entityKind"`
EntitySubtype   string  `json:"entitySubtype"`
EntityLabel     string  `json:"entityLabel"`
Color           string  `json:"color"`
IsTypedRoot     bool    `json:"isTypedRoot"`
IsSubtypeRoot   bool    `json:"isSubtypeRoot"`
Collapsed       bool    `json:"collapsed"`
OwnerID         string  `json:"ownerId"`
IsNarrativeRoot bool    `json:"isNarrativeRoot"`
Attributes      string  `json:"attributes,omitempty"`
CreatedAt       int64   `json:"createdAt"`
UpdatedAt       int64   `json:"updatedAt"`
}

func main() {
f := Folder{
ID:          "123",
Name:        "Narrative Timeline",
WorldID:     "",
NarrativeID: "123",
FolderOrder: 1000,
CreatedAt:   1772691415139,
UpdatedAt:   1772691415139,
}
b, _ := json.Marshal(f)
fmt.Println(string(b))
}

