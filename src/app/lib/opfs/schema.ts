
export const SCHEMA_V1 = `
    :create object {
        id: String,
        kind: String,
        mtime: Int,
        ctime: Int
    }

    :create attachment {
        object_id: String,
        role: String,
        cid: String,
        size: Int,
        mime: String
    }

    :create prop {
        object_id: String,
        key: String,
        value: Json
    }

    :create edge {
        src: String, 
        rel: String, 
        dst: String
    }

    :create view {
        id: String, 
        name: String, 
        query: String
    }
`;
