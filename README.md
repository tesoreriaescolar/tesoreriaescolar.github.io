# Tesorería Escolar

Aplicación para administrar la tesorería de los eventos escolares de un
grupo de colegio. Hecha para sobrevivir el paso de kínder a primaria y a
secundaria: el año escolar es un dato, no una suposición del código.

**https://tesoreriaescolar.github.io**

## Cómo está armado

| | |
|---|---|
| Pantalla | Un solo `index.html`, sin framework. GitHub Pages desde `main`, carpeta raíz. |
| Lógica | Ocho workflows de n8n (`tes/…`). Toda la validación de permisos vive ahí. Tres credenciales: `tesoreria-escolar-db · app_rw`, `tesoreria-escolar-db · config_ro` y `tesoreria-escolar · correo`. |
| Datos | PostgreSQL en Railway. Nueve tablas. |
| Fotos | Bucket S3 en Railway. Las fotos **nunca** pasan por la base ni por n8n. |

```
index.html   la aplicación completa
db/          las migraciones, en orden
n8n/         los workflows: fuentes, ensamblador y JSON
```

## Lo que el navegador NO decide

La pantalla decide qué botón pintar. **Nada más.** Todo lo que importa se
resuelve en el servidor, y está escrito así a propósito:

- El filtrado por salón va en el `WHERE` del SQL. Una mamá ve los eventos
  de generación y los de su propio salón; los de otro salón **no salen de
  la base**, no es que se escondan al pintar.
- El vencimiento de un préstamo se mide contra el reloj del **servidor**.
  Atrasar el reloj del celular no revive un préstamo vencido.
- Confirmar un presupuesto congela su total. No se vuelve a calcular.
- Cada cambio escribe su bitácora en la misma transacción. Si falla la
  bitácora, se revierte el cambio.
- El secreto con el que se firman las sesiones lo alcanza **una sola
  credencial, en un solo nodo**. La credencial con la que corren los cinco
  workflows de API no llega ahí.
- Las contraseñas se comparan contra un revuelto (PBKDF2-SHA256, 100 000
  vueltas, con sal por persona). En claro no se guardan nunca, y al poner
  una nueva ni siquiera salen del navegador.

## Versión

`VERSION` en `index.html` manda la etiqueta de la esquina. De `V1.01` a
`V9.99`:

- **centésima** en cada publicación
- **décima** cuando cambia la base de datos
- **entero** cuando se rompe la compatibilidad hacia atrás

## Datos personales

Este repositorio es **público**. No entran nombres, correos, teléfonos,
CLABEs ni contraseñas. Y borrar un archivo no lo borra del historial: si
algo así se llega a subir, se trata como filtración, no como error de
dedo.
