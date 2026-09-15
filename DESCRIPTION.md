# Towarzysz

Ktos siedzi w stopce i patrzy, jak ci idzie. Pikselowy towarzysz, losowany raz
na postac - inny wyglad, inne imie, inny glos - reaguje na to, co dzieje sie w
grze, i od czasu do czasu cos powie w dymku nad stopka. Ma nastroj, ktory
plynie razem z sesja. Nie ma potrzeb, nie da sie go zaniedbac, nie umrze.

To ma byc towarzystwo, nie obowiazek: mily widok katem oka, latwy do
zapomnienia, nigdy system, ktory czegos od ciebie chce.

## Co potrafi

- **Losowany, nie projektowany** - archetyp (mag, czarodziej, wiesniak, potwor,
  ogr, ork, goblin), kolory, imie i glos losuja sie z imienia postaci. Ta sama
  postac zawsze dostaje tego samego towarzysza, nawet po wyczyszczeniu
  przegladarki. Jedno losowanie od nowa, nigdy wiecej.
- **Reaguje animacja na wszystko** - zabicia, postepy, obrazenia, smierc,
  monety, zakupy, sprzedaz, ocena kamieni, bezczynnosc. Zawsze cos zrobi,
  rzadko cos powie.
- **Powsciagliwosc jest funkcja** - przerwa miedzy kwestiami (domyslnie 45 s),
  osobne przerwy i prawdopodobienstwa na kategorie. Przez dwadziescia zabic
  milczy, przy dwudziestym pierwszym cos rzuci. Ale na smierc, niebotyczne
  postepy i kamien wart co najmniej 2 mithryle odezwie sie nawet w trakcie
  przerwy - to te chwile, dla ktorych ta reakcja w ogole istnieje. Kamienie
  przebijaja przerwe najwyzej raz na 10 minut, bo trafiaja sie workami.
- **Cztery glosy** - Wierny giermek, Zgryzliwy weteran, Ponury wieszcz,
  Maloomowny. Glos losuje sie niezaleznie od wygladu: goblin mowiacy jak
  ponury wieszcz to dokladnie ten rodzaj pary, dla ktorego warto losowac.
- **Nastroj** - jedna liczba, ktora plynie z sesja i zabarwia to, co mowi.
  Ta sama rzecz brzmi inaczej w dobry wieczor niz po trzeciej smierci.
- **Nie smieci w oknie gry** - mowi tylko w dymku nad stopka. Nigdy nie drukuje
  do wyjscia gry.

## Komendy

| Komenda | Dziala |
| --- | --- |
| `/towarzysz` | ustawienia: cisza calkowita i na kategorie, glos, przerwy, losowanie od nowa |
| `/towarzysz cisza` | szybkie wyciszenie / odciszenie |
| `/towarzysz status` | kim jest, jaki ma nastroj, statystyki |
| `/towarzysz powiedz` | niech cos powie (test dymka) |

Klikniecie w towarzysza w stopce tez otwiera ustawienia.

## Instalacja

1. W menedzerze pluginow Arkadia Web Client dodaj adres:
   `https://delwing.github.io/arkadia-towarzysz/plugin.js`
2. Zaloguj sie postacia - towarzysz pojawi sie w stopce, gdy klient pozna jej imie.

## Prywatnosc

Stan lezy w localStorage przegladarki (`plugin:towarzysz:<imie postaci>`) -
**nic nie jest nigdzie wysylane**, plugin nie wykonuje zadnych zapytan
sieciowych - nawet po grafike, bo ta rysuje sie sama w przegladarce.

## Grafika

Sprite'y sa wlasne i nie ma ich w postaci plikow: rysuje je kod, osobno dla
kazdego towarzysza, w jego wylosowanych kolorach. Dlatego towarzysz bez broni
naprawde jej nie ma, a nie ma ja zamalowana.

Autor: Dargoth
