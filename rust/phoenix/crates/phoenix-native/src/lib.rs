pub fn runtime_banner() -> &'static str {
    "phoenix-native foundation ready"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_banner_is_stable() {
        assert_eq!(runtime_banner(), "phoenix-native foundation ready");
    }
}
