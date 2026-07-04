// ESLint 9 flat config. @raycast/eslint-config exports the Raycast rule set as a
// flat-config array (js + typescript-eslint + @raycast/eslint-plugin + prettier);
// we re-export it so `ray lint` runs the standard Raycast checks. The `dist` and
// generated env types are not linted.
const raycast = require("@raycast/eslint-config");

module.exports = [
  ...raycast,
  {
    ignores: ["dist/**", "raycast-env.d.ts"],
  },
];
