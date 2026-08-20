import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";

export default [
	js.configs.recommended,
	...svelte.configs["flat/recommended"],
	{
		files: ["**/*.svelte"],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
			},
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
		},
	},
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
		},
	},
	{
		ignores: ["dist/**", "node_modules/**", "build/**"],
	},
];