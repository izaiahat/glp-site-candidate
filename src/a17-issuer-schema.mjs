// Exact A12b schema snapshot; schema is shape, not review authority.
export const issuerSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://a12.invalid/issuer-record.schema.json",
  "title": "A12 future record SHAPE only; validation grants no permission",
  "oneOf": [
    {
      "$ref": "#/$defs/permission"
    },
    {
      "$ref": "#/$defs/consent"
    }
  ],
  "$defs": {
    "platform_enums": {
      "allOf": [
        {
          "if": {
            "properties": {
              "platform": {
                "const": "meta"
              }
            },
            "required": [
              "platform"
            ]
          },
          "then": {
            "properties": {
              "event_name": {
                "enum": [
                  "Lead",
                  "TEST_A12_Meta_B2BInquiry",
                  "TEST_A12_Meta_CaptureProbe"
                ]
              },
              "event_names": {
                "items": {
                  "enum": [
                    "Lead",
                    "TEST_A12_Meta_B2BInquiry",
                    "TEST_A12_Meta_CaptureProbe"
                  ]
                }
              },
              "allowed_payload_fields": {
                "items": {
                  "enum": [
                    "event_name",
                    "event_time",
                    "event_id",
                    "action_source",
                    "event_source_url",
                    "user_data.fbc",
                    "user_data.fbp"
                  ]
                }
              },
              "allowed_identifiers": {
                "properties": {
                  "capture": {
                    "items": {
                      "enum": [
                        "fbclid",
                        "fbc",
                        "fbp"
                      ]
                    }
                  },
                  "export": {
                    "items": {
                      "enum": [
                        "fbc",
                        "fbp"
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "platform": {
                "const": "microsoft"
              }
            },
            "required": [
              "platform"
            ]
          },
          "then": {
            "properties": {
              "event_name": {
                "enum": [
                  "GCS_B2B_AdminInquiry",
                  "gcs_b2b_admin_inquiry",
                  "TEST_A12_Microsoft_B2BInquiry",
                  "TEST_A12_Microsoft_CaptureProbe"
                ]
              },
              "event_names": {
                "items": {
                  "enum": [
                    "GCS_B2B_AdminInquiry",
                    "gcs_b2b_admin_inquiry",
                    "TEST_A12_Microsoft_B2BInquiry",
                    "TEST_A12_Microsoft_CaptureProbe"
                  ]
                }
              },
              "allowed_payload_fields": {
                "items": {
                  "enum": [
                    "ConversionName",
                    "ConversionTime",
                    "MicrosoftClickId",
                    "ConversionValue",
                    "ConversionCurrencyCode"
                  ]
                }
              },
              "allowed_identifiers": {
                "properties": {
                  "capture": {
                    "items": {
                      "enum": [
                        "msclkid"
                      ]
                    }
                  },
                  "export": {
                    "items": {
                      "enum": [
                        "msclkid"
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "platform": {
                "const": "google"
              }
            },
            "required": [
              "platform"
            ]
          },
          "then": {
            "properties": {
              "event_name": {
                "enum": [
                  "GCS_B2B_AdminInquiry",
                  "TEST_A12_Google_B2BInquiry",
                  "TEST_A12_Google_CaptureProbe"
                ]
              },
              "event_names": {
                "items": {
                  "enum": [
                    "GCS_B2B_AdminInquiry",
                    "TEST_A12_Google_B2BInquiry",
                    "TEST_A12_Google_CaptureProbe"
                  ]
                }
              },
              "allowed_payload_fields": {
                "items": {
                  "enum": [
                    "conversion_action",
                    "conversion_date_time",
                    "gclid",
                    "conversion_value",
                    "currency_code",
                    "order_id",
                    "consent.ad_user_data",
                    "consent.ad_personalization"
                  ]
                }
              },
              "allowed_identifiers": {
                "properties": {
                  "capture": {
                    "items": {
                      "enum": [
                        "gclid"
                      ]
                    }
                  },
                  "export": {
                    "items": {
                      "enum": [
                        "gclid"
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      ]
    },
    "permission": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema",
        "evidence_ref",
        "revision",
        "status",
        "issuer_id",
        "review_ref",
        "reviewer_id",
        "platform",
        "account_id",
        "target_id",
        "origin",
        "source_ref",
        "source_revision",
        "purpose",
        "is_test",
        "probe_ref",
        "issued_at_ms",
        "expires_at_ms",
        "revocation_epoch",
        "source_type",
        "event_class",
        "event_definition",
        "event_name",
        "allowed_identifiers",
        "allowed_payload_fields",
        "ownership_evidence_ref",
        "lawful_basis_review_ref",
        "tos_refs",
        "notice_version",
        "notice_sha256",
        "retention_policy_ref",
        "erasure_owner",
        "transport_contract_ref",
        "payload_schema_sha256"
      ],
      "properties": {
        "schema": {
          "const": "a12-platform-permission-v1"
        },
        "evidence_ref": {
          "type": "string",
          "minLength": 1
        },
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "status": {
          "enum": [
            "DRAFT_DENY",
            "ELIGIBLE",
            "REVOKED",
            "EXPIRED"
          ]
        },
        "issuer_id": {
          "type": "string",
          "minLength": 1
        },
        "review_ref": {
          "type": "string",
          "minLength": 1
        },
        "reviewer_id": {
          "type": "string",
          "minLength": 1
        },
        "platform": {
          "enum": [
            "meta",
            "microsoft",
            "google"
          ]
        },
        "account_id": {
          "type": "string",
          "minLength": 1
        },
        "target_id": {
          "type": "string",
          "minLength": 1
        },
        "origin": {
          "type": "string",
          "pattern": "^https://[^/?#@]+$"
        },
        "source_ref": {
          "type": "string",
          "minLength": 1
        },
        "source_revision": {
          "type": "string",
          "minLength": 1
        },
        "purpose": {
          "const": "ad_measurement"
        },
        "is_test": {
          "type": "boolean"
        },
        "probe_ref": {
          "type": [
            "string",
            "null"
          ]
        },
        "issued_at_ms": {
          "type": "integer",
          "minimum": 0
        },
        "expires_at_ms": {
          "type": "integer",
          "minimum": 0
        },
        "revocation_epoch": {
          "type": "integer",
          "minimum": 0
        },
        "source_type": {
          "enum": [
            "owned_b2b_inquiry",
            "synthetic_go_probe"
          ]
        },
        "event_class": {
          "enum": [
            "non_sensitive_b2b",
            "synthetic_transport_probe"
          ]
        },
        "event_definition": {
          "type": "string",
          "minLength": 1
        },
        "event_name": {
          "type": "string",
          "minLength": 1
        },
        "allowed_identifiers": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "capture",
            "export"
          ],
          "properties": {
            "capture": {
              "type": "array",
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "enum": [
                  "gclid",
                  "msclkid",
                  "fbclid",
                  "fbc",
                  "fbp"
                ]
              }
            },
            "export": {
              "type": "array",
              "minItems": 1,
              "uniqueItems": true,
              "items": {
                "enum": [
                  "gclid",
                  "msclkid",
                  "fbc",
                  "fbp"
                ]
              }
            }
          }
        },
        "allowed_payload_fields": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "ownership_evidence_ref": {
          "type": "string",
          "minLength": 1
        },
        "lawful_basis_review_ref": {
          "type": "string",
          "minLength": 1
        },
        "tos_refs": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "source_id",
              "requested_url",
              "final_url",
              "retrieved_on",
              "effective_date",
              "version_label",
              "captured_sha256",
              "scope_review_ref",
              "account_acceptance_ref",
              "reviewed_at_ms"
            ],
            "properties": {
              "source_id": {
                "type": "string",
                "minLength": 1
              },
              "requested_url": {
                "type": "string",
                "minLength": 1
              },
              "final_url": {
                "type": "string",
                "minLength": 1
              },
              "retrieved_on": {
                "type": "string",
                "format": "date"
              },
              "effective_date": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date"
              },
              "version_label": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "captured_sha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "scope_review_ref": {
                "type": "string",
                "minLength": 1
              },
              "account_acceptance_ref": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1
              },
              "reviewed_at_ms": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        },
        "notice_version": {
          "type": "string",
          "minLength": 1
        },
        "notice_sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "retention_policy_ref": {
          "type": "string",
          "minLength": 1
        },
        "erasure_owner": {
          "type": "string",
          "minLength": 1
        },
        "transport_contract_ref": {
          "type": "string",
          "minLength": 1
        },
        "payload_schema_sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "allOf": [
        {
          "$ref": "#/$defs/platform_enums"
        },
        {
          "if": {
            "properties": {
              "status": {
                "not": {
                  "const": "DRAFT_DENY"
                }
              }
            },
            "required": [
              "status"
            ]
          },
          "then": {
            "properties": {
              "tos_refs": {
                "items": {
                  "properties": {
                    "account_acceptance_ref": {
                      "type": "string",
                      "minLength": 1
                    }
                  }
                }
              }
            }
          }
        },
        {
          "if": {
            "properties": {
              "is_test": {
                "const": true
              }
            }
          },
          "then": {
            "properties": {
              "probe_ref": {
                "type": "string",
                "minLength": 1
              }
            }
          },
          "else": {
            "properties": {
              "probe_ref": {
                "type": "null"
              },
              "source_type": {
                "const": "owned_b2b_inquiry"
              },
              "event_class": {
                "const": "non_sensitive_b2b"
              }
            }
          }
        }
      ]
    },
    "consent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema",
        "receipt_id",
        "version",
        "subject_ref",
        "permission_ref",
        "permission_revision",
        "permission_sha256",
        "platform",
        "account_id",
        "target_id",
        "origin",
        "source_ref",
        "source_revision",
        "purpose",
        "is_test",
        "probe_ref",
        "issued_at_ms",
        "expires_at_ms",
        "revocation_epoch",
        "event_names",
        "notice_version",
        "notice_sha256",
        "choice",
        "choice_at_ms",
        "ad_storage",
        "ad_user_data",
        "ad_personalization",
        "gpc",
        "withdrawn",
        "issuer_id"
      ],
      "properties": {
        "schema": {
          "const": "a12-advertising-consent-v1"
        },
        "receipt_id": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "version": {
          "type": "string",
          "minLength": 1
        },
        "subject_ref": {
          "type": "string",
          "minLength": 1
        },
        "permission_ref": {
          "type": "string",
          "minLength": 1
        },
        "permission_revision": {
          "type": "integer",
          "minimum": 1
        },
        "permission_sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "platform": {
          "enum": [
            "meta",
            "microsoft",
            "google"
          ]
        },
        "account_id": {
          "type": "string",
          "minLength": 1
        },
        "target_id": {
          "type": "string",
          "minLength": 1
        },
        "origin": {
          "type": "string",
          "pattern": "^https://[^/?#@]+$"
        },
        "source_ref": {
          "type": "string",
          "minLength": 1
        },
        "source_revision": {
          "type": "string",
          "minLength": 1
        },
        "purpose": {
          "const": "ad_measurement"
        },
        "is_test": {
          "type": "boolean"
        },
        "probe_ref": {
          "type": [
            "string",
            "null"
          ]
        },
        "issued_at_ms": {
          "type": "integer",
          "minimum": 0
        },
        "expires_at_ms": {
          "type": "integer",
          "minimum": 0
        },
        "revocation_epoch": {
          "type": "integer",
          "minimum": 0
        },
        "event_names": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "notice_version": {
          "type": "string",
          "minLength": 1
        },
        "notice_sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "choice": {
          "const": "explicit_opt_in"
        },
        "choice_at_ms": {
          "type": "integer",
          "minimum": 0
        },
        "ad_storage": {
          "enum": [
            "granted",
            "denied"
          ]
        },
        "ad_user_data": {
          "enum": [
            "granted",
            "denied"
          ]
        },
        "ad_personalization": {
          "const": "denied"
        },
        "gpc": {
          "type": "boolean"
        },
        "withdrawn": {
          "type": "boolean"
        },
        "issuer_id": {
          "type": "string",
          "minLength": 1
        }
      },
      "allOf": [
        {
          "$ref": "#/$defs/platform_enums"
        },
        {
          "if": {
            "properties": {
              "is_test": {
                "const": true
              }
            }
          },
          "then": {
            "properties": {
              "probe_ref": {
                "type": "string",
                "minLength": 1
              }
            }
          },
          "else": {
            "properties": {
              "probe_ref": {
                "type": "null"
              }
            }
          }
        }
      ]
    }
  }
};
