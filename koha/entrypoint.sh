#!/bin/bash
set -e

INSTANCE="${KOHA_INSTANCE:-edubox}"
DB_HOST="${KOHA_DB_HOST:-mariadb}"
DB_NAME="${KOHA_DB_NAME:-koha}"
DB_USER="${KOHA_DB_USER:-koha}"
DB_PASS="${KOHA_DB_PASS:-koha}"
MEMCACHED="${MEMCACHED_SERVER:-memcached:11211}"

echo "[EduBox Koha] Starting instance: $INSTANCE"

# Activer les modules Apache requis par Koha
a2enmod headers proxy_http rewrite deflate expires 2>/dev/null || true

# Attendre que MariaDB soit prête
echo "[EduBox Koha] Waiting for MariaDB at $DB_HOST:3306..."
for i in $(seq 1 60); do
    if mysqladmin ping -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" --silent 2>/dev/null; then
        echo "[EduBox Koha] MariaDB is ready"
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo "[EduBox Koha] ERROR: MariaDB not ready after 60 tries"
        exit 1
    fi
    echo "[EduBox Koha] Waiting for DB... ($i/60)"
    sleep 5
done

# Créer l'instance Koha si elle n'existe pas
if [ ! -d "/etc/koha/sites/$INSTANCE" ]; then
    echo "[EduBox Koha] Creating new Koha instance: $INSTANCE"

    # koha-create a besoin d'un user root pour créer la DB
    # On utilise le user koha qui a déjà été créé par le script SQL d'init
    koha-create --request-db "$INSTANCE" 2>/dev/null || true

    # Si koha-create --request-db a échoué ou si l'instance n'existe pas
    if [ ! -d "/etc/koha/sites/$INSTANCE" ]; then
        # Créer manuellement la structure minimale
        mkdir -p "/etc/koha/sites/$INSTANCE"
        cat > "/etc/koha/sites/$INSTANCE/koha-conf.xml" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE config SYSTEM "koha-conf.dtd">
<config>
  <listen id="biblioserver">tcp:@:9998</listen>
  <listen id="authorityserver">tcp:@:9999</listen>
  <server id="biblioserver" listenref="biblioserver">
    <directory>/var/lib/koha/$INSTANCE/biblios</directory>
    <config>/etc/koha/sites/$INSTANCE/zebra-biblios.cfg</config>
    <cql2rpn>/usr/share/idzebra-2.0/tab/pqf.properties</cql2rpn>
    <retrieval syntax="usmarc" name="F"/>
    <retrieval syntax="usmarc" name="B"/>
    <retrieval syntax="xml" name="F" identifier="info:srw/schema/1/marcxml-v1.1"/>
  </server>
  <server id="authorityserver" listenref="authorityserver">
    <directory>/var/lib/koha/$INSTANCE/authorities</directory>
    <config>/etc/koha/sites/$INSTANCE/zebra-authorities.cfg</config>
    <cql2rpn>/usr/share/idzebra-2.0/tab/pqf.properties</cql2rpn>
    <retrieval syntax="usmarc" name="F"/>
    <retrieval syntax="usmarc" name="B"/>
    <retrieval syntax="xml" name="F" identifier="info:srw/schema/1/marcxml-v1.1"/>
  </server>
  <yazgfs>
    <recordtype name="biblios">marc21</recordtype>
    <recordtype name="authorities">marc21</recordtype>
  </yazgfs>
  <db_scheme>mysql</db_scheme>
  <database>$DB_NAME</database>
  <hostname>$DB_HOST</hostname>
  <port>3306</port>
  <user>$DB_USER</user>
  <pass>$DB_PASS</pass>
  <biblioserver>biblioserver</biblioserver>
  <authorityserver>authorityserver</authorityserver>
  <pluginsdir>/var/lib/koha/$INSTANCE/plugins</pluginsdir>
  <upload_path>/var/lib/koha/$INSTANCE/uploads</upload_path>
  <tmp_path>/tmp/koha-$INSTANCE</tmp_path>
  <lockdir>/var/lock/koha/$INSTANCE</lockdir>
  <logdir>/var/log/koha/$INSTANCE</logdir>
  <intranetdir>/usr/share/koha/intranet/cgi-bin</intranetdir>
  <opacdir>/usr/share/koha/opac/cgi-bin</opacdir>
  <intrahtdocs>/usr/share/koha/intranet/htdocs</intrahtdocs>
  <opachtdocs>/usr/share/koha/opac/htdocs</opachtdocs>
  <memcached_servers>$MEMCACHED</memcached_servers>
  <memcached_namespace>koha_$INSTANCE</memcached_namespace>
  <log4perl_conf>/etc/koha/sites/$INSTANCE/log4perl.conf</log4perl_conf>
</config>
EOF
    fi

    echo "[EduBox Koha] Instance structure created"
fi

# Créer les répertoires de données
mkdir -p \
    "/var/lib/koha/$INSTANCE/biblios" \
    "/var/lib/koha/$INSTANCE/authorities" \
    "/var/lib/koha/$INSTANCE/plugins" \
    "/var/lib/koha/$INSTANCE/uploads" \
    "/var/log/koha/$INSTANCE" \
    "/var/lock/koha/$INSTANCE" \
    "/tmp/koha-$INSTANCE"

# Configurer Apache pour Koha
if [ ! -f "/etc/apache2/sites-enabled/$INSTANCE.conf" ]; then
    cat > "/etc/apache2/sites-available/$INSTANCE.conf" << EOF
<VirtualHost *:8080>
    ServerName koha-opac
    DocumentRoot /usr/share/koha/opac/htdocs
    SetEnv KOHA_CONF "/etc/koha/sites/$INSTANCE/koha-conf.xml"
    SetEnv PERL5LIB "/usr/share/koha/lib"
    ScriptAlias /cgi-bin/ /usr/share/koha/opac/cgi-bin/
    Alias /opac-tmpl/ /usr/share/koha/opac/htdocs/opac-tmpl/
    <Directory /usr/share/koha/opac/cgi-bin/>
        Options ExecCGI
        SetHandler cgi-script
        Require all granted
    </Directory>
    <Directory /usr/share/koha/opac/htdocs/>
        Require all granted
    </Directory>
</VirtualHost>

<VirtualHost *:8081>
    ServerName koha-staff
    DocumentRoot /usr/share/koha/intranet/htdocs
    SetEnv KOHA_CONF "/etc/koha/sites/$INSTANCE/koha-conf.xml"
    SetEnv PERL5LIB "/usr/share/koha/lib"
    ScriptAlias /cgi-bin/ /usr/share/koha/intranet/cgi-bin/
    Alias /intranet-tmpl/ /usr/share/koha/intranet/htdocs/intranet-tmpl/
    <Directory /usr/share/koha/intranet/cgi-bin/>
        Options ExecCGI
        SetHandler cgi-script
        Require all granted
    </Directory>
    <Directory /usr/share/koha/intranet/htdocs/>
        Require all granted
    </Directory>
</VirtualHost>
EOF
    a2ensite "$INSTANCE.conf" 2>/dev/null || true
fi

# Configurer les ports Apache
cat > /etc/apache2/ports.conf << 'PORTS'
Listen 8080
Listen 8081
PORTS

echo "[EduBox Koha] Starting services..."
exec "$@"
