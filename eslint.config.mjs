import globals from "globals";
import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2022,
            }
        },
        ignores: ["**/xtscancodes.js"],
        rules: {
            // Unsafe or confusing stuff that we forbid

            "no-unused-vars": ["error", { "vars": "all",
                                          "args": "none",
                                          "ignoreRestSiblings": true,
                                          "caughtErrors": "none" }],
            "no-constant-condition": ["error", { "checkLoops": false }],
            "no-var": "error",
            "no-useless-constructor": "error",
            "object-shorthand": ["error", "methods", { "avoidQuotes": true }],
            "prefer-arrow-callback": "error",
            "arrow-body-style": ["error", "as-needed", { "requireReturnForObjectLiteral": false } ],
            "arrow-parens": ["error", "as-needed", { "requireForBlockBody": true }],
            "arrow-spacing": ["error"],
            "no-confusing-arrow": ["error", { "allowParens": true }],

            // Enforced coding style

            "brace-style": ["error", "1tbs", { "allowSingleLine": true }],
            "indent": ["error", 4, { "SwitchCase": 1,
                                     "VariableDeclarator": "first",
                                     "FunctionDeclaration": { "parameters": "first" },
                                     "FunctionExpression": { "parameters": "first" },
                                     "CallExpression": { "arguments": "first" },
                                     "ArrayExpression": "first",
                                     "ObjectExpression": "first",
                                     "ImportDeclaration": "first",
                                     "ignoreComments": true }],
            "comma-spacing": ["error"],
            "comma-style": ["error"],
            "curly": ["error", "multi-line"],
            "func-call-spacing": ["error"],
            "func-names": ["error"],
            "func-style": ["error", "declaration", { "allowArrowFunctions": true }],
            "key-spacing": ["error"],
            "keyword-spacing": ["error"],
            "no-trailing-spaces": ["error"],
            "semi": ["error"],
            "space-before-blocks": ["error"],
            "space-before-function-paren": ["error", { "anonymous": "always",
                                                       "named": "never",
                                                       "asyncArrow": "always" }],
            "switch-colon-spacing": ["error"],
            "camelcase": ["error", { "allow": ["^XK_", "^XF86XK_"] }],
            "no-console": ["error"],
        }
    },
    {
        files: ["po/po2js", "po/xgettext-html"],
        languageOptions: {
            globals: {
                ...globals.node,
            }
        },
        rules: {
            "no-console": 0,
        },
    },
    {
        files: ["tests/*"],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.mocha,
                sinon: false,
                expect: false,
            }
        },
        rules: {
            "prefer-arrow-callback": 0,
            // Too many anonymous callbacks
            "func-names": "off",
        },
    },
    {
        files: ["utils/*"],
        languageOptions: {
            globals: {
                ...globals.node,
            }
        },
        rules: {
            "no-console": 0,
        },
    },
];
