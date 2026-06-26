import re
path = 'renderer/app.js'
with open(path, 'r', encoding='utf-8') as f:
    t = f.read()

def repl(m):
    return m.group(0).replace('\n', '').replace('\r', '')

t = re.sub(r"i\.innerHTML = '<svg.*?</svg>';", repl, t, flags=re.DOTALL)
with open(path, 'w', encoding='utf-8') as f:
    f.write(t)
