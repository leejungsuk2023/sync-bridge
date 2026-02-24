import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./pages/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}', './app/**/*.{js,ts,jsx,tsx,mdx}'],
  safelist: [
    // Landing page dynamic color classes
    { pattern: /bg-(blue|green|purple|orange|red)-(50|100|200|600|700)/ },
    { pattern: /text-(blue|green|purple|orange|red)-(600|700)/ },
    { pattern: /border-(blue|green|purple|orange|red)-(200)/ },
  ],
  theme: { extend: {} },
  plugins: [],
};
export default config;
