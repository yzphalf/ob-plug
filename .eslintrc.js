module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off', // Too many legacy uses for now
        '@typescript-eslint/ban-ts-comment': 'off',
        'no-unused-vars': 'off', // Handled by TS
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
    env: {
        node: true,
    },
};
