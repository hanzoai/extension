// .eslintrc.json in the form ESLint 10 reads; it reads no other.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import typescript from '@typescript-eslint/eslint-plugin';

export default [
    { ignores: ['out/', 'dist/', 'scripts/', '.vscode-test/', '**/*.d.ts', '**/*.js'] },
    js.configs.recommended,
    ...typescript.configs['flat/recommended'],
    {
        plugins: { '@stylistic': stylistic },
        rules: {
            '@typescript-eslint/naming-convention': 'warn',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            // Lazy CJS requires are how this extension keeps activation fast.
            // The old config turned off no-var-requires for them; typescript-
            // eslint 8 flags them under this name.
            '@typescript-eslint/no-require-imports': 'off',
            // typescript-eslint 8 moved its semi rule to @stylistic.
            '@stylistic/semi': 'warn',
            'curly': 'warn',
            'eqeqeq': 'warn',
            'no-throw-literal': 'warn'
        }
    }
];
