/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}", "./src/navigation/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          lighter: '#C8FAD6',
          light: '#5BE49B',
          DEFAULT: '#4CBB17',
          main: '#4CBB17',
          dark: '#007867',
          darker: '#004B50',
          contrastText: '#FFFFFF',
        },
        secondary: {
          lighter: '#EFD6FF',
          light: '#C684FF',
          DEFAULT: '#8E33FF',
          main: '#8E33FF',
          dark: '#5119B7',
          darker: '#27097A',
          contrastText: '#FFFFFF',
        },
        info: {
          lighter: '#CAFDF5',
          light: '#61F3F3',
          DEFAULT: '#00B8D9',
          main: '#00B8D9',
          dark: '#006C9C',
          darker: '#003768',
        },
        success: {
          lighter: '#D3FCD2',
          light: '#77ED8B',
          DEFAULT: '#22C55E',
          main: '#22C55E',
          dark: '#118D57',
          darker: '#065E49',
        },
        warning: {
          lighter: '#FFF5CC',
          light: '#FFD666',
          DEFAULT: '#FFAB00',
          main: '#FFAB00',
          dark: '#B76E00',
          darker: '#7A4100',
        },
        error: {
          lighter: '#FFE9D5',
          light: '#FFAC82',
          DEFAULT: '#FF5630',
          main: '#FF5630',
          dark: '#B71D18',
          darker: '#7A0916',
        },
        grey: {
          0: '#FFFFFF',
          100: '#F9FAFB',
          200: '#F4F6F8',
          300: '#DFE3E8',
          400: '#C4CDD5',
          500: '#919EAB',
          600: '#637381',
          700: '#454F5B',
          800: '#212B36',
          900: '#161C24',
        }
      }
    },
  },
  plugins: [],
}