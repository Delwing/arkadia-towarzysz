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
  przegladarki. Nie da sie go wylosowac jeszcze raz - dostajesz tego, ktory ci wypadl.
- **Reaguje animacja na wszystko** - zabicia, postepy, obrazenia, smierc,
  monety, zakupy, sprzedaz, ocena kamieni, trunki i kac, wiedza, oczyszczona
  lokacja, ogluszenie, wedkowanie, poklad statku, przeobrazenie, bezczynnosc.
  Zawsze cos zrobi, rzadko cos powie.
- **Czeka razem z toba** - przy zarzuconej wedce siada obok i siedzi, dopoki
  cos nie wezmie; ogluszony zatacza sie dokladnie tak dlugo, jak dlugo nie
  mozesz nic zrobic. Reakcja przerwie taka postawe i odda ja z powrotem.
- **Zyje wlasnym zyciem** - gdy nic sie nie dzieje, co pol minuty przejdzie
  sie po stopce, zamigocze albo zniknie w slupie swiatla i wroci kawalek
  dalej. Nigdy przy tym nic nie mowi i nigdy nie przerywa reakcji.
- **Powsciagliwosc jest funkcja** - przerwa miedzy kwestiami (domyslnie 45 s),
  osobne przerwy i prawdopodobienstwa na kategorie. Przez dwadziescia zabic
  milczy, przy dwudziestym pierwszym cos rzuci. Ale na smierc, niebotyczne
  postepy, przeobrazenie i kamien wart co najmniej 2 mithryle odezwie sie nawet
  w trakcie przerwy - to te chwile, dla ktorych ta reakcja w ogole istnieje.
  Kamienie przebijaja przerwe najwyzej raz na 10 minut, bo trafiaja sie workami.
- **Cztery glosy** - Wierny giermek, Zgryzliwy weteran, Ponury wieszcz,
  Maloomowny. Glos losuje sie niezaleznie od wygladu: goblin mowiacy jak
  ponury wieszcz to dokladnie ten rodzaj pary, dla ktorego warto losowac.
- **Nastroj** - jedna liczba, ktora plynie z sesja i zabarwia to, co mowi.
  Ta sama rzecz brzmi inaczej w dobry wieczor niz po trzeciej smierci. Sam z
  siebie wraca powoli do zera - w jakies dwadziescia minut gry mniej wiecej o
  polowe - ale liczy sie tylko czas przy grze: nastroj, na ktorym konczysz
  wieczor, zastajesz nastepnego dnia.
- **Nie smieci w oknie gry** - mowi tylko w dymku nad stopka. Nigdy nie drukuje
  do wyjscia gry.

## Komendy

| Komenda | Dziala |
| --- | --- |
| `/towarzysz` | karta towarzysza: kto to, jak wyglada, jaki ma nastroj, co razem przeszliscie |
| `/towarzysz cisza` | szybkie wyciszenie / odciszenie |
| `/towarzysz status` | kim jest, jaki ma nastroj, statystyki |
| `/towarzysz powiedz` | niech cos powie (test dymka) |
| `/towarzysz ruch` | niech sie przejdzie (test ruchu wlasnego) |

Klikniecie w towarzysza w stopce tez otwiera karte. Nie ma tu nic do ustawiania:
towarzysz jest losowany, nie konfigurowany.

## Instalacja

1. W menedzerze pluginow Arkadia Web Client dodaj adres:
   `https://delwing.github.io/arkadia-towarzysz/plugin.js`
2. Zaloguj sie postacia - towarzysz pojawi sie w stopce, gdy klient pozna jej imie.

## Prywatnosc

Stan lezy w localStorage przegladarki (`plugin:towarzysz:<imie postaci>`) -
**nic nie jest nigdzie wysylane**, plugin nie wykonuje zadnych zapytan
sieciowych - nawet po grafike, bo ta rysuje sie sama w przegladarce.

## Grafika

Sprite'y pochodza z [Pixel Art Sprite Mixer](https://kingbell.itch.io/pixel-sprite-mixer)
KingBella (licencja CC-BY 4.0) - 115 animacji, z ktorych plugin uzywa
kilkunastu. W repozytorium nie ma plikow graficznych: klatki sa spakowane jako
tekst i przemalowywane w przegladarce na wylosowane kolory towarzysza, a
elementy stroju (kapelusz maga, kly ogra) doklejane sa do glowy klatka po
klatce.

Autor: Dargoth
