// CSS-importer används av Expos web-mål. Expo genererar normalt dessa
// deklarationer i expo-env.d.ts (git-ignorerad) vid `expo start`; vi committar
// en egen så att typkontroll fungerar även utan att Metro har körts.
declare module "*.css";
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
