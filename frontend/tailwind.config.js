/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stage: {
          950: '#04060B',
          900: '#080C15',
          800: '#0E1422',
          700: '#131B2E',
          600: '#1C2640',
          500: '#24304E',
          400: '#2D3C5C',
          300: '#4A5C78',
          200: '#687A96',
          100: '#94A3B8',
          50:  '#F1F5F9',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Playfair Display', 'Georgia', 'serif'],
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up':    'fade-up 0.35s ease-out both',
        'fade-in':    'fade-in 0.25s ease-out both',
        'waveform':   'waveform 1.8s ease-in-out infinite alternate',
        'bounce-dot': 'bounce-dot 1.4s ease-in-out infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.55)' },
          '50%':      { boxShadow: '0 0 0 18px rgba(239, 68, 68, 0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'waveform': {
          '0%':   { transform: 'scaleY(0.25)', opacity: '0.4' },
          '100%': { transform: 'scaleY(1)',    opacity: '1' },
        },
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%':           { transform: 'translateY(-6px)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      boxShadow: {
        'glow-crimson':'0 0 32px rgba(239, 68, 68, 0.35)',
        'card':        '0 1px 3px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
}
