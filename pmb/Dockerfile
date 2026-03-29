FROM php:8.3-apache

# PHP extensions required by PMB
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev libjpeg-dev libfreetype6-dev libzip-dev libxml2-dev \
        libcurl4-openssl-dev libxslt1-dev libicu-dev libonig-dev \
        libbz2-dev libsqlite3-dev \
        unzip wget \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && (docker-php-ext-install mysqli pdo_mysql gd zip xsl intl bz2 soap sockets sqlite3 exif; exit 0) \
    && php -m | grep -E "(mysqli|pdo_mysql|gd|zip|xsl|intl|bz2|soap|sockets|sqlite3|exif)" \
    && rm -rf /var/lib/apt/lists/*

# PHP settings recommended by PMB
RUN { \
        echo "date.timezone=Europe/Paris"; \
        echo "display_errors=Off"; \
        echo "expose_php=Off"; \
        echo "max_execution_time=300"; \
        echo "max_input_vars=50000"; \
        echo "memory_limit=256M"; \
        echo "post_max_size=64M"; \
        echo "upload_max_filesize=64M"; \
    } > /usr/local/etc/php/conf.d/pmb.ini

# Enable mod_rewrite
RUN a2enmod rewrite

# Download and extract PMB v8.1.0.6
RUN wget -q "https://forge.sigb.net/attachments/download/5308/pmb8.1.0.6.zip" -O /tmp/pmb.zip \
    && unzip -q /tmp/pmb.zip -d /var/www/html/ \
    && rm /tmp/pmb.zip

# Allow .htaccess overrides
RUN sed -i 's|AllowOverride None|AllowOverride All|g' /etc/apache2/apache2.conf

# PMB needs write access for its upload/data dirs
RUN chown -R www-data:www-data /var/www/html/pmb

EXPOSE 80
