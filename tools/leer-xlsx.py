"""Lector minimo de .xlsx: hojas, formulas y valores. Sin dependencias.

POR QUE EXISTE. El Excel original —`Modelo_Costeo_Auditado_SNACKLAB.xlsx`— es la
fuente de todas las formulas de `docs/SPEC.md`, y **no esta versionado ni debe
estarlo**: es dato de cliente (CLAUDE.md 7). Pero se puede leer, y en P8 leerlo
cerro una duda que llevaba dos paquetes abierta y encontro dos divergencias que
nadie habia escrito.

Un `.xlsx` es un ZIP con XML. No hace falta `openpyxl` —una dependencia mas para
esto seria justo lo que YAGNI prohibe—: sesenta lineas de `zipfile` y
`ElementTree` bastan para ver las formulas, que es lo unico que interesa.

USO:

    unzip -q "<ruta al xlsx>" -d /tmp/xl        # y ajusta BASE
    python tools/leer-xlsx.py                   # lista las hojas
    python tools/leer-xlsx.py V_INVENTARIO 5-6  # formulas de esas filas

NO IMPRIME EL ARCHIVO ENTERO A PROPOSITO. Se pide una hoja y un rango: lo que se
busca es una formula concreta, no un volcado de datos de cliente.
"""
import os
import sys
import xml.etree.ElementTree as ET

# Donde se descomprimio el .xlsx. Fuera del repositorio, SIEMPRE: el archivo es
# dato de cliente y no puede acabar versionado por accidente.
BASE = os.environ.get('XLSX_DIR', '') + '/'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NSR = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def hojas():
    libro = ET.parse(BASE + 'xl/workbook.xml').getroot()
    rels = ET.parse(BASE + 'xl/_rels/workbook.xml.rels').getroot()
    destino = {r.get('Id'): r.get('Target') for r in rels}
    salida = {}
    for hoja in libro.find(NS + 'sheets'):
        salida[hoja.get('name')] = destino[hoja.get(NSR + 'id')].split('/')[-1]
    return salida


def cadenas():
    try:
        raiz = ET.parse(BASE + 'xl/sharedStrings.xml').getroot()
    except FileNotFoundError:
        return []
    fuera = []
    for si in raiz:
        fuera.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    return fuera


SS = cadenas()


def leer(nombre, filas=None, con_formula=True):
    archivo = hojas()[nombre]
    raiz = ET.parse(BASE + 'xl/worksheets/' + archivo).getroot()
    for fila in raiz.find(NS + 'sheetData'):
        n = int(fila.get('r'))
        if filas and n not in filas:
            continue
        celdas = []
        for c in fila:
            ref = c.get('r')
            f = c.find(NS + 'f')
            v = c.find(NS + 'v')
            texto = None
            if v is not None:
                texto = v.text
                if c.get('t') == 's' and texto is not None:
                    texto = SS[int(texto)]
            if f is not None and con_formula:
                celdas.append(f'{ref}= {f.text}   -> {texto}')
            elif texto not in (None, ''):
                celdas.append(f'{ref}: {texto}')
        if celdas:
            print(f'--- fila {n}')
            for celda in celdas:
                print('   ', celda)


if __name__ == '__main__':
    if len(sys.argv) == 1:
        for nombre, archivo in hojas().items():
            print(nombre, '->', archivo)
    else:
        nombre = sys.argv[1]
        rango = None
        if len(sys.argv) > 2:
            ini, fin = sys.argv[2].split('-')
            rango = set(range(int(ini), int(fin) + 1))
        leer(nombre, rango)
