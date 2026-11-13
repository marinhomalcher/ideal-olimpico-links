# Uso (na raiz do repositório): python3 _cloudflare/atlas-api/nova-versao.py 20261114a
# Grava a versão em todas as páginas do ATLAS (meta atlas-versao), no versao.json e no ?v= dos scripts.
# As páginas abertas comparam com versao.json e se recarregam sozinhas. Rode a cada entrega que mude atlas/.
import sys, re, glob, json, os
V = sys.argv[1]
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'atlas') + os.sep
for p in glob.glob(R + '*.html'):
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'<meta name="atlas-versao" content="[^"]*">', f'<meta name="atlas-versao" content="{V}">', s)
    s = re.sub(r'((?:auth|atlas-[a-z-]+))\.js\?v=[0-9a-z]+', lambda m: f'{m.group(1)}.js?v={V}', s)
    assert f'content="{V}"' in s, p
    open(p, 'w', encoding='utf-8').write(s)
open(R + 'versao.json', 'w').write(json.dumps({'versao': V}) + '\n')
print('versão', V)
