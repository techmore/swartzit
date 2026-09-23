use serde::{Deserialize, Serialize};

pub const RULE_VERSION: &str = "swartzit-moderation-v1";

const PROFANITY_TERMS: &[&str] = &[
    "asshole",
    "bitch",
    "bullshit",
    "cunt",
    "damn",
    "fuck",
    "motherfucker",
    "shit",
];
const SLUR_TERMS: &[&str] = &[
    "chink", "faggot", "kike", "nigga", "nigger", "spic", "tranny", "wetback",
];
const HARASSMENT_TERMS: &[&str] = &["idiot", "loser", "moron", "shut up", "stupid"];
const THREAT_PHRASES: &[&str] = &[
    "burn your house",
    "come for you",
    "find you",
    "hurt you",
    "kill you",
    "shoot you",
    "stab you",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Flag {
    pub category: String,
    pub severity: String,
    pub rule: String,
}

#[derive(Clone, Debug)]
pub struct Analysis {
    pub flags: Vec<Flag>,
    pub severity: String,
    pub urgent: bool,
}

impl Analysis {
    pub fn new() -> Self {
        Self {
            flags: Vec::new(),
            severity: "none".into(),
            urgent: false,
        }
    }

    pub fn add_flag(&mut self, category: &str, severity: &str, rule: &str) {
        if self.flags.iter().any(|flag| flag.rule == rule) {
            return;
        }
        self.flags.push(Flag {
            category: category.into(),
            severity: severity.into(),
            rule: rule.into(),
        });
        if severity_rank(severity) > severity_rank(&self.severity) {
            self.severity = severity.into();
        }
        if category == "threat" && severity_rank(severity) >= severity_rank("high") {
            self.urgent = true;
        }
    }
}

impl Default for Analysis {
    fn default() -> Self {
        Self::new()
    }
}

fn severity_rank(value: &str) -> u8 {
    match value {
        "low" => 1,
        "medium" => 2,
        "high" => 3,
        _ => 0,
    }
}

fn normalize_char(value: char) -> Option<char> {
    let lower = value.to_ascii_lowercase();
    let mapped = match lower {
        '0' => 'o',
        '1' | '!' => 'i',
        '3' => 'e',
        '4' | '@' => 'a',
        '5' | '$' => 's',
        '7' => 't',
        value if value.is_ascii_alphanumeric() => lower,
        _ => return Some(' '),
    };
    Some(mapped)
}

fn normalized_words(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let leet_symbol = matches!(value, '!' | '@' | '$');
            let embedded = index > 0
                && index + 1 < chars.len()
                && chars[index - 1].is_ascii_alphanumeric()
                && chars[index + 1].is_ascii_alphanumeric();
            if leet_symbol && !embedded {
                ' '
            } else {
                *value
            }
        })
        .filter_map(normalize_char)
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

pub fn comparison_key(text: &str) -> String {
    normalized_words(text).join("")
}

fn phrase_present(words: &[String], phrase: &str) -> bool {
    let wanted: Vec<&str> = phrase.split_whitespace().collect();
    if wanted.is_empty() {
        return false;
    }
    words.windows(wanted.len()).any(|window| {
        window
            .iter()
            .zip(wanted.iter())
            .all(|(actual, expected)| actual == expected)
    })
}

fn repeated_character_run(text: &str) -> bool {
    let mut previous = None;
    let mut run = 0;
    for value in text.chars() {
        if Some(value) == previous {
            run += 1;
            if run >= 8 {
                return true;
            }
        } else {
            previous = Some(value);
            run = 1;
        }
    }
    false
}

pub fn analyze(text: &str) -> Analysis {
    let words = normalized_words(text);
    let mut result = Analysis::new();

    if words
        .iter()
        .any(|word| PROFANITY_TERMS.iter().any(|term| word == term))
    {
        result.add_flag("profanity", "medium", "profanity.term");
    }
    if words
        .iter()
        .any(|word| SLUR_TERMS.iter().any(|term| word == term))
    {
        result.add_flag("slur", "high", "slur.term");
    }
    if HARASSMENT_TERMS
        .iter()
        .any(|phrase| phrase_present(&words, phrase))
    {
        result.add_flag("harassment", "medium", "harassment.term");
    }
    if THREAT_PHRASES
        .iter()
        .any(|phrase| phrase_present(&words, phrase))
    {
        result.add_flag("threat", "high", "threat.phrase");
    }

    let links = text.matches("http://").count() + text.matches("https://").count();
    if links >= 4 {
        result.add_flag("spam", "medium", "spam.link_burst");
    } else if links >= 2 {
        result.add_flag("spam", "low", "spam.multiple_links");
    }
    if repeated_character_run(text) {
        result.add_flag("spam", "low", "spam.repeated_character");
    }

    let letters: Vec<char> = text.chars().filter(|value| value.is_alphabetic()).collect();
    let uppercase = letters.iter().filter(|value| value.is_uppercase()).count();
    if letters.len() >= 24 && uppercase * 100 / letters.len() >= 85 {
        result.add_flag("spam", "low", "spam.excessive_caps");
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_obfuscated_threat_without_recording_match_text() {
        let result = analyze("I will k1ll y0u");
        assert!(result.urgent);
        assert_eq!(result.severity, "high");
        assert_eq!(result.flags[0].category, "threat");
        assert!(
            !serde_json::to_string(&result.flags)
                .unwrap()
                .contains("k1ll")
        );
    }

    #[test]
    fn catches_profanity_and_spam_signals() {
        let result = analyze("THIS IS SHIT!!!!! https://one.example https://two.example");
        assert!(result.flags.iter().any(|flag| flag.category == "profanity"));
        assert!(result.flags.iter().any(|flag| flag.category == "spam"));
    }

    #[test]
    fn comparison_key_collapses_obfuscation() {
        assert_eq!(comparison_key("S.h.i.t"), "shit");
    }
}
