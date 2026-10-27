# Kokpit

Kokpit je mod za Claude Code koji pokazuje stanje sesije: popunjenost konteksta, limite plana (5 h i 7 d), trošak i keš. Nudi akcije poput sažimanja razgovora, AI analizu potrošnje s preporukama, pregled troškova po sedmicama i projektima, budžet, te pinovane artefakte po projektu s brzim otvaranjem iz trake iznad polja za unos.

## Instalacija

U terminalu, u Claude Code sesiji:

```
/plugin install kokpit --marketplace adnandzaficVS/kokpit
```

Iz shella:

```
claude plugin install kokpit --marketplace adnandzaficVS/kokpit
```

U desktop aplikaciji: kliknuti + pored polja za unos, zatim Plugins, Add marketplace s `adnandzaficVS/kokpit`, pa Add plugin.

## Korištenje

- Traka iznad polja za unos: kontekst, limiti, trošak, meni Artefakti i dugme Kokpit (drugi klik zatvara panel).
- `/kokpit` otvara panel, `/kokpit-analiza` analizira sesiju, `/kokpit-historija` prikazuje trošak ranijih sesija, `/kokpit-pin <link> [naziv]` pinuje artefakt za projekat.
