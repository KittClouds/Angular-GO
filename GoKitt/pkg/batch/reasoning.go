package batch

func (s *Service) buildReasoningConfig() map[string]interface{} {
	if !s.config.ReasoningEnabled {
		return nil
	}

	reasoning := map[string]interface{}{}
	effort := s.config.ReasoningEffort
	if effort == "" {
		effort = "medium"
	}
	reasoning["effort"] = effort

	if s.config.ReasoningMaxTokens > 0 {
		reasoning["max_tokens"] = s.config.ReasoningMaxTokens
	}
	if !s.config.IncludeReasoning {
		reasoning["exclude"] = true
	}

	return reasoning
}
